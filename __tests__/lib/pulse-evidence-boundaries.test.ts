import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Exercise the production SQL against local PostgreSQL. Only the provider and
// unrelated maintenance panel are replaced; no credentials or network are used.
const state = vi.hoisted(() => ({
  pg: null as PGlite | null,
  provider: vi.fn(),
  fanout: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => {
  type Query = { text: string; values: unknown[] }
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((result, part, index) => result + (index ? `$${index}` : '') + part, '')
    return { text, values, then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      state.pg!.query(text, values).then(result => result.rows).then(resolve, reject) }
  }
  sql.transaction = (queries: Query[]) => state.pg!.transaction(async tx => {
    const rows = []
    for (const query of queries) rows.push((await tx.query(query.text, query.values)).rows)
    return rows
  })
  return { db: () => sql }
})
vi.mock('@/lib/openrouter', async original => ({
  ...await original<typeof import('@/lib/openrouter')>(),
  callOpenRouterWithEvidence: state.provider,
  callMultiPlatform: state.fanout,
}))
vi.mock('@/lib/pulse/analysis', () => ({ analyseAnswer: async () => ({ classificationStatus: 'classified',
  method: 'offline-fixture', version: 'fixture.v1', brandMentioned: false, sentiment: 'unknown',
  mentionPosition: null, competitorsMentioned: [], matchedText: [] }) }))
vi.mock('@/lib/pulse/runs/classification', () => ({ classifySavedAnswers: async () => 0 }))
vi.mock('@/lib/workspace/maintenance', () => ({ loadMaintenanceSnapshot: async () => null }))

import { createOrResumeRun } from '@/lib/pulse/runs/store'
import { runPulseChunk } from '@/lib/pulse/runs/service'
import { consumeDuePulseWork, pulseWorkerPorts } from '@/lib/pulse/runs/worker'
import { listPendingRunPage } from '@/lib/pulse/runs/queue'
import { modelVariantsFor } from '@/lib/openrouter'
import { loadOwnedPulse } from '@/lib/workspace/load-owned-pulse'
import { loadOwnedWorkspace } from '@/lib/workspace/load-owned-workspace'
import { db } from '@/lib/db'
import { selectPendingClientPage } from '@/lib/pulse/schedule'
import { POST } from '@/app/api/pulse/run/route'
import { NextRequest } from 'next/server'

const ACCOUNT = '10000000-0000-4000-8000-000000000001'
const CLIENT = '20000000-0000-4000-8000-000000000001'
const OTHER = '20000000-0000-4000-8000-000000000002'
const PROMPT = '30000000-0000-4000-8000-000000000001'
const WEEK = '2026-10-05'
const scope = { accountId: ACCOUNT, clientId: CLIENT }
const evidence = { answer: 'A saved answer.', actualModel: 'fixture/model', requestId: 'fixture-request',
  promptTokens: 1, completionTokens: 2, costUsd: null, httpStatus: 200 }

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create role aeo_app;
    create table accounts(id uuid primary key,plan text,status text,stripe_subscription_id text,
      trial_ends_at timestamptz,override_plan text,override_expires_at timestamptz);
    create table clients(id uuid primary key,account_id uuid references accounts(id),brand_name text,
      domain text,industry text,status text,competitors text[],created_at timestamptz default now(),unique(id,account_id));
    create table prompt_bank(id uuid primary key,client_id uuid references clients(id),question text,
      category text,language text,market text,is_active boolean default true);
    create table pulse_metrics(id uuid primary key default gen_random_uuid(),client_id uuid references clients(id),
      prompt_id uuid constraint pulse_metrics_prompt_id_fkey references prompt_bank(id),platform text,question text,
      raw_answer text,scan_week date,created_at timestamptz default now(),brand_mentioned boolean,
      sentiment text,mention_position integer,competitors_mentioned text[]);
    create table pulse_weekly_summary(id uuid primary key default gen_random_uuid(),client_id uuid references clients(id),
      scan_week date,platform text,total_queries integer,brand_mentions integer,sov_score numeric,
      avg_sentiment_score numeric,top_competitors jsonb,created_at timestamptz default now(),
      unique nulls not distinct(client_id,scan_week,platform));
    create table scans(id uuid primary key,client_id uuid references clients(id),account_id uuid references accounts(id),
      domain text,score numeric,grade text,created_at timestamptz,results jsonb,agent_status text);
  `)
  for (const file of ['057_pulse_run_ledger.sql', '058_pulse_classification_repair.sql', '060_provider_citations.sql']) {
    await state.pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }
})
afterAll(async () => { await state.pg?.close() })
beforeEach(async () => {
  vi.stubEnv('FEATURE_PULSE_ATTEMPTS', '1')
  vi.stubEnv('OPENROUTER_API_KEY', 'offline-provider-fixture')
  state.provider.mockReset().mockResolvedValue(evidence)
  state.fanout.mockReset().mockResolvedValue([{ platform: 'gemini-flash', answer: 'An offline answer.' }])
  await state.pg!.exec('truncate accounts cascade')
  await state.pg!.query("insert into accounts(id,plan,status,stripe_subscription_id) values ($1,'pro','active','sub_fixture')", [ACCOUNT])
  await state.pg!.query("insert into clients(id,account_id,brand_name,status,competitors) values ($1,$2,'Fixture Brand','active','{}')", [CLIENT, ACCOUNT])
  await state.pg!.query("insert into prompt_bank(id,client_id,question,language,market) values ($1,$2,'Active question?','en','HK')", [PROMPT, CLIENT])
})

describe('compatibility Pulse target status', () => {
  it.each(['paused', 'removed'])('excludes %s targets from the flag-off schedule with an active control', async status => {
    vi.stubEnv('FEATURE_PULSE_ATTEMPTS', '0')
    await state.pg!.query('insert into clients(id,account_id,brand_name,status) values ($1,$2,$3,$4)', [OTHER, ACCOUNT, 'Inactive brand', status])
    await state.pg!.query("insert into prompt_bank(id,client_id,question,language) values (gen_random_uuid(),$1,'Inactive question?','en')", [OTHER])
    const page = await selectPendingClientPage(db(), { limit: 5, scanWeek: WEEK, deadlineMs: Date.now() + 5_000 })
    expect(page.items.map(item => item.clientId)).toEqual([CLIENT])
  })

  it.each(['paused', 'removed'])('refuses a %s target before compatibility fan-out after an active control succeeds', async status => {
    vi.stubEnv('FEATURE_PULSE_ATTEMPTS', '0')
    vi.stubEnv('CRON_SECRET', 'offline-fixture-secret')
    const request = () => new NextRequest('http://localhost/api/pulse/run', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'offline-fixture-secret' },
      body: JSON.stringify({ clientId: CLIENT }) })
    expect((await POST(request())).status).toBe(200)
    expect(state.fanout).toHaveBeenCalledTimes(1)
    await state.pg!.query('update clients set status=$1 where id=$2', [status, CLIENT])
    const denied = await POST(request())
    expect(denied.status).toBe(404)
    expect(await denied.json()).toEqual({ error: 'Client not found' })
    expect(state.fanout).toHaveBeenCalledTimes(1)
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('Pulse dispatch respects the current target', () => {
  it('blocks old Pro manifest variants after a Basic downgrade without rewriting the manifest', async () => {
    const run = await createOrResumeRun(scope, { scanWeek: WEEK, manifest: modelVariantsFor(['gpt-4o', 'gemini-flash']) })
    await state.pg!.query("update accounts set plan='basic' where id=$1", [ACCOUNT])
    const result = await runPulseChunk(scope, { scanWeek: WEEK, platforms: ['gemini-flash'], limit: 5, deadlineAt: Date.now() + 45_000 })
    expect(state.provider.mock.calls.map(([options]) => options.model)).toEqual(['google/gemini-3.8-flash'])
    expect(result.coverage).toMatchObject({ expected: 2, succeeded: 1, blocked: 1, pending: 0 })
    const { rows } = await state.pg!.query<{ manifest: unknown }>('select manifest from pulse_runs where id=$1', [run!.id])
    expect(rows[0].manifest).toEqual(run!.manifest)
  })

  it('keeps paused targets out of repair dispatch while an active owned control still collects', async () => {
    await createOrResumeRun(scope, { scanWeek: WEEK, manifest: modelVariantsFor(['gemini-flash']) })
    await state.pg!.query("insert into clients(id,account_id,brand_name,status,competitors) values ($1,$2,'Paused Brand','active','{}')", [OTHER, ACCOUNT])
    await state.pg!.query("insert into prompt_bank(id,client_id,question,language) values (gen_random_uuid(),$1,'Paused question?','en')", [OTHER])
    await createOrResumeRun({ accountId: ACCOUNT, clientId: OTHER }, { scanWeek: WEEK, manifest: modelVariantsFor(['gemini-flash']) })
    await state.pg!.query("update clients set status='paused' where id=$1", [OTHER])
    await consumeDuePulseWork({ mode: 'repair', owner: 'offline-fixture', deadlineAt: Date.now() + 45_000 })
    expect(state.provider.mock.calls.map(([options]) => options.messages.at(-1).content)).toEqual(['Active question?'])
    expect((await listPendingRunPage(null)).runs.map(run => run.clientId)).toEqual([CLIENT])
    const { rows } = await state.pg!.query<{ count: number }>('select count(*)::int as count from pulse_item_attempts where client_id=$1', [OTHER])
    expect(rows[0].count).toBe(0)
  })

  it.each(['paused', 'removed'])('refuses a %s target before the direct chunk can spend', async status => {
    await createOrResumeRun(scope, { scanWeek: WEEK, manifest: modelVariantsFor(['gemini-flash']) })
    await state.pg!.query('update clients set status=$1 where id=$2', [status, CLIENT])
    await expect(runPulseChunk(scope, { scanWeek: WEEK, platforms: ['gemini-flash'], limit: 5, deadlineAt: Date.now() + 45_000 }))
      .rejects.toThrow('Run scope unavailable')
    expect(state.provider).not.toHaveBeenCalled()
  })
})

describe('confirmed missed opportunities', () => {
  it.each(['pulse', 'workspace'] as const)('%s excludes unknown classifications and foreign evidence', async surface => {
    for (const [question, status, answer, mentioned] of [
      ['Confirmed miss', 'classified', 'Rival is suggested.', false],
      ['Legacy unknown', 'legacy_unknown', 'An old answer.', false],
      ['Fallback unknown', 'fallback', 'An uncertain answer.', false],
      ['Failed classifier', 'failed', 'An unclassified answer.', false],
      ['Blank answer', 'classified', '   ', false],
      ['Brand mentioned', 'classified', 'Fixture Brand.', true],
    ] as const) {
      await state.pg!.query(`insert into pulse_metrics(client_id,prompt_id,platform,question,raw_answer,scan_week,brand_mentioned,classification_status)
        values ($1,$2,'gemini-flash',$3,$4,$5,$6,$7)`, [CLIENT, PROMPT, question, answer, WEEK, mentioned, status])
    }
    await state.pg!.query("insert into accounts(id,plan,status) values ($1,'pro','active')", [OTHER])
    await state.pg!.query("insert into clients(id,account_id,brand_name,status) values ($1,$2,'Foreign Brand','active')", [OTHER, OTHER])
    await state.pg!.query(`insert into pulse_metrics(client_id,platform,question,raw_answer,scan_week,brand_mentioned,classification_status)
      values ($1,'gemini-flash','Foreign miss','Foreign answer',$2,false,'classified')`, [OTHER, WEEK])
    const input = { clientId: CLIENT, profile: { account_id: ACCOUNT } }
    const result = surface === 'pulse' ? await loadOwnedPulse(input) : await loadOwnedWorkspace(input)
    expect(result?.missed.status).toBe('ok')
    expect(result?.missed.data.map(row => row.question)).toEqual(['Confirmed miss'])
  })
})

describe('recoverable Pulse rollups', () => {
  async function classifySavedFixture() {
    await state.pg!.query("update pulse_run_items set classification_status='classified',updated_at=now() where client_id=$1 and status='succeeded'", [CLIENT])
    await state.pg!.query("update pulse_metrics set classification_status='classified',brand_mentioned=false where client_id=$1", [CLIENT])
    return 1
  }
  const repair = () => ({ mode: 'repair' as const, owner: 'offline-rollup-fixture', deadlineAt: Date.now() + 45_000 })

  it('retries a failed final rollup on the next invocation without collecting the provider answer again', async () => {
    const run = await createOrResumeRun(scope, { scanWeek: WEEK, manifest: modelVariantsFor(['gemini-flash']) })
    const ports = pulseWorkerPorts()
    ports.classify = classifySavedFixture
    ports.summarize = async () => { throw new Error('Synthetic rollup outage') }
    expect(await consumeDuePulseWork(repair(), ports)).toMatchObject({ outcome: 'partial', errors: 1 })
    expect((await state.pg!.query('select status from pulse_runs where id=$1', [run!.id])).rows).toEqual([{ status: 'completed' }])
    expect((await state.pg!.query('select * from pulse_weekly_summary')).rows).toHaveLength(0)
    const retried = await consumeDuePulseWork(repair())
    expect(retried).toMatchObject({ outcome: 'complete', runIds: [run!.id], processed: 0 })
    expect((await state.pg!.query('select total_queries,brand_mentions from pulse_weekly_summary where platform is null')).rows)
      .toEqual([{ total_queries: 1, brand_mentions: 0 }])
    expect(state.provider).toHaveBeenCalledTimes(1)
    expect(await consumeDuePulseWork(repair())).toMatchObject({ outcome: 'complete', empty: true, processed: 0 })
  })

  it('refreshes an older rollup after the last classification and stops selecting it once current', async () => {
    const run = await createOrResumeRun(scope, { scanWeek: WEEK, manifest: modelVariantsFor(['gemini-flash']) })
    await consumeDuePulseWork(repair())
    await classifySavedFixture()
    await state.pg!.query("update pulse_weekly_summary set created_at='2000-01-01' where client_id=$1", [CLIENT])
    await state.pg!.query("update pulse_metrics set brand_mentioned=true,sentiment='positive' where client_id=$1", [CLIENT])
    expect(await consumeDuePulseWork(repair())).toMatchObject({ outcome: 'complete', runIds: [run!.id], processed: 0 })
    expect((await state.pg!.query('select brand_mentions,sov_score::int from pulse_weekly_summary where platform is null')).rows)
      .toEqual([{ brand_mentions: 1, sov_score: 100 }])
    expect((await listPendingRunPage(null)).runs).toEqual([])
    expect(state.provider).toHaveBeenCalledTimes(1)
  })
})
