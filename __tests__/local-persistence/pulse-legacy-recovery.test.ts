import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ collect: vi.fn(), classify: vi.fn() }))
vi.mock('@/lib/openrouter', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/openrouter')>(),
  callMultiPlatform: h.collect,
  callOpenRouter: h.classify,
}))
import { POST } from '@/app/api/pulse/run/route'
import { claimDueItems, commitAttempt, createOrResumeRun } from '@/lib/pulse/runs/store'

const owner = neon(process.env.TEST_DATABASE_URL!)
const pendingCleanup: string[] = []
const owned: string[] = []
const secret = 'fixture-legacy-sql-secret-00000001'

async function fixture() {
  const accountId = randomUUID(), clientId = randomUUID(), promptId = randomUUID()
  pendingCleanup.push(accountId)
  owned.push(accountId)
  await owner`insert into accounts(id,plan,status,stripe_subscription_id) values(${accountId},'basic','active',${'synthetic-' + accountId})`
  await owner`insert into clients(id,account_id,brand_name,domain) values(${clientId},${accountId},'Synthetic recovery','fixture.example')`
  await owner`insert into prompt_bank(id,client_id,question,category,language,market,is_active) values(${promptId},${clientId},'Frozen synthetic question','brand_query','en','HK',true)`
  const [row] = await owner`select to_char(date_trunc('week',now() at time zone 'UTC'),'YYYY-MM-DD') as week`
  h.collect.mockReset().mockImplementation(async (_messages: unknown, _limit: unknown, platforms: string[]) =>
    platforms.map(platform => ({ platform, answer: 'Synthetic new canonical answer', providerCitations: null, grounding: 'none' })))
  h.classify.mockReset().mockResolvedValue(JSON.stringify({ brand_mentioned: false, sentiment: 'not_mentioned', competitors_mentioned: [] }))
  vi.stubEnv('CRON_SECRET', secret)
  vi.stubEnv('FEATURE_PULSE_ATTEMPTS', '0')
  vi.stubEnv('FEATURE_PULSE_GROUNDING', '0')
  return { accountId, clientId, promptId, week: String(row.week).slice(0, 10) }
}

async function post(clientId: string) {
  return POST(new Request('http://127.0.0.1/api/pulse/run', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({ clientId, limit: 1 }),
  }) as never)
}

async function ledgerMetric(f: Awaited<ReturnType<typeof fixture>>, purpose: 'canonical' | 'retest', raw: string) {
  const scope = { accountId: f.accountId, clientId: f.clientId }
  const manifest = [{ platform: 'gemini-flash', model: 'synthetic/gemini' }]
  const canonical = (await createOrResumeRun(scope, {
    scanWeek: f.week, manifest, intent: { kind: 'initial', intentKey: 'legacy-baseline' },
  }))!
  const run = purpose === 'canonical' ? canonical : (await createOrResumeRun(scope, {
    scanWeek: f.week, manifest, intent: { kind: 'retest', intentKey: 'legacy-retest', sourceRunId: canonical.id },
  }))!
  const [lease] = await claimDueItems(scope, run.id, {
    owner: 'synthetic-test', leaseUntil: new Date(Date.now() + 60000), limit: 1,
  })
  expect(await commitAttempt(lease, {
    kind: 'succeeded', evidence: {
      answer: raw, actualModel: null, requestId: null, promptTokens: null,
      completionTokens: null, costUsd: null, httpStatus: 200,
    },
  })).toBe('committed')
  const [metric] = await owner`
    select m.id,m.raw_answer,m.run_item_id from pulse_metrics m
    join pulse_run_items i on i.id=m.run_item_id where m.client_id=${f.clientId} and i.run_id=${run.id}
  `
  return metric
}

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const id of pendingCleanup.splice(0)) {
    await owner`delete from ai_citation_log where client_id in(select id from clients where account_id=${id})`
    await owner`delete from pulse_weekly_summary where client_id in(select id from clients where account_id=${id})`
    await owner`delete from pulse_metrics where client_id in(select id from clients where account_id=${id})`
    await owner`update pulse_run_items set accepted_attempt_id=null where account_id=${id}`
    await owner`delete from pulse_classification_attempts where account_id=${id}`
    await owner`delete from pulse_item_attempts where account_id=${id}`
    await owner`delete from pulse_run_items where account_id=${id}`
    await owner`delete from pulse_runs where account_id=${id} and purpose='retest'`
    await owner`delete from pulse_runs where account_id=${id}`
    await owner`delete from accounts where id=${id}`
  }
})
afterAll(async () => {
  const [counts] = await owner`
    select (select count(*)::int from accounts where id=any(${owned}::uuid[])) accounts,
      (select count(*)::int from clients where account_id=any(${owned}::uuid[])) brands,
      (select count(*)::int from pulse_runs where account_id=any(${owned}::uuid[])) runs
  `
  expect(counts).toEqual({ accounts: 0, brands: 0, runs: 0 })
  writeFileSync('artifacts/aiso-development-20261013/T36-legacy-sql-cleanup.json', JSON.stringify({
    at: new Date().toISOString(), testOwnedAccounts: owned.length, counts, auth: 'none; cron fixture only',
  }, null, 2))
})

describe('T36 legacy recovery real app-role PostgreSQL (not Auth/live)', () => {
  it('retains nonblank unknown raw/citations and dispatches no collection or classifier on retry', async () => {
    const f = await fixture(), raw = 'Synthetic 原文🙂\n'
    const citations = [{ url: 'https://source.example/retained', title: 'Synthetic source' }]
    const [before] = await owner`
      insert into pulse_metrics(client_id,prompt_id,question,platform,scan_week,raw_answer,provider_citations,classification_status)
      values(${f.clientId},${f.promptId},'Frozen synthetic question','gemini-flash',${f.week}::date,${raw},${JSON.stringify(citations)}::jsonb,'legacy_unknown')
      returning id,raw_answer,provider_citations,classification_status,brand_mentioned
    `
    expect((await post(f.clientId)).status).toBe(200)
    expect(h.collect.mock.calls).toHaveLength(0)
    expect(h.classify.mock.calls).toHaveLength(0)
    const rows = await owner`select id,raw_answer,provider_citations,classification_status,brand_mentioned from pulse_metrics where client_id=${f.clientId}`
    expect(rows).toEqual([before])
    const [summary] = await owner`
      select total_queries,sov_score,avg_sentiment_score from pulse_weekly_summary
      where client_id=${f.clientId} and platform is null
    `
    expect(summary).toEqual({ total_queries: 1, sov_score: null, avg_sentiment_score: null })
  })

  it('a same-week retest raw does not suppress a missing canonical answer or get rewritten', async () => {
    const f = await fixture()
    const before = await ledgerMetric(f, 'retest', 'Immutable synthetic retest raw')
    expect((await post(f.clientId)).status).toBe(200)
    expect(h.collect.mock.calls.map(c => c[2])).toEqual([['gemini-flash']])
    const rows = await owner`select id,raw_answer,run_item_id from pulse_metrics where client_id=${f.clientId} order by id`
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.id === before.id)).toEqual(before)
    expect(rows.find(r => r.run_item_id === null)?.raw_answer).toBe('Synthetic new canonical answer')
    const [summary] = await owner`select total_queries from pulse_weekly_summary where client_id=${f.clientId} and platform is null`
    expect(summary.total_queries).toBe(1)
  })

  it('reuses run-linked canonical raw without modifying the run or recollecting', async () => {
    const f = await fixture()
    const before = await ledgerMetric(f, 'canonical', 'Immutable synthetic canonical raw')
    const runsBefore = await owner`select * from pulse_runs where account_id=${f.accountId}`
    expect((await post(f.clientId)).status).toBe(200)
    expect(h.collect.mock.calls).toHaveLength(0)
    expect(h.classify.mock.calls).toHaveLength(0)
    expect(await owner`select id,raw_answer,run_item_id from pulse_metrics where client_id=${f.clientId}`).toEqual([before])
    expect(await owner`select * from pulse_runs where account_id=${f.accountId}`).toEqual(runsBefore)
  })

  it('replaces whitespace-only legacy rows but retains blank run-linked retest evidence', async () => {
    const f = await fixture()
    const retest = await ledgerMetric(f, 'retest', 'Synthetic retest placeholder')
    // Simulate a retained historic blank metric without changing its ledger attempt.
    await owner`update pulse_metrics set raw_answer=${' \t\n\r '} where id=${retest.id}`
    const [before] = await owner`select id,raw_answer,run_item_id from pulse_metrics where id=${retest.id}`
    await owner`
      insert into pulse_metrics(client_id,prompt_id,question,platform,scan_week,raw_answer)
      values(${f.clientId},${f.promptId},'Frozen synthetic question','gemini-flash',${f.week}::date,${' \t\n\r '})
    `
    expect((await post(f.clientId)).status).toBe(200)
    const rows = await owner`select id,raw_answer,run_item_id from pulse_metrics where client_id=${f.clientId}`
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.id === retest.id)).toEqual(before)
    expect(rows.filter(r => r.run_item_id === null).map(r => r.raw_answer)).toEqual(['Synthetic new canonical answer'])
    expect(h.collect.mock.calls.map(c => c[2])).toEqual([['gemini-flash']])
  })

  it('another tenant or week cannot suppress this tenant collection or be changed by it', async () => {
    const f = await fixture(), foreign = await fixture()
    const [foreignBefore] = await owner`
      insert into pulse_metrics(client_id,prompt_id,question,platform,scan_week,raw_answer)
      values(${foreign.clientId},${foreign.promptId},'Foreign synthetic question','gemini-flash',${f.week}::date,'Foreign immutable raw') returning *
    `
    const [oldBefore] = await owner`
      insert into pulse_metrics(client_id,prompt_id,question,platform,scan_week,raw_answer)
      values(${f.clientId},${f.promptId},'Frozen synthetic question','gemini-flash',${f.week}::date-7,'Prior immutable raw') returning *
    `
    expect((await post(f.clientId)).status).toBe(200)
    expect(h.collect.mock.calls.map(c => c[2])).toEqual([['gemini-flash']])
    expect(await owner`select * from pulse_metrics where id=${foreignBefore.id}`).toEqual([foreignBefore])
    expect(await owner`select * from pulse_metrics where id=${oldBefore.id}`).toEqual([oldBefore])
    const [current] = await owner`select count(*)::int n from pulse_metrics where client_id=${f.clientId} and scan_week=${f.week}::date`
    expect(current.n).toBe(1)
  })
})
