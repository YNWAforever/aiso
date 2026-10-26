import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsEvent } from '@/lib/outcome-integrations/input'

const h = vi.hoisted(() => ({ pg: null as PGlite | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => {
  type Query = { text: string; values: unknown[] }
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    return { text, values, then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => h.pg!.query(text, values).then(result => result.rows).then(resolve, reject) }
  }
  sql.transaction = (queries: Query[]) => h.pg!.transaction(async tx => { const out = []; for (const query of queries) out.push((await tx.query(query.text, query.values)).rows); return out })
  return { db: () => sql }
})
import * as store from '@/lib/outcome-integrations/store'
import { writeSearchAppearance } from '@/lib/integrations/search-console/store'

const account = '11000000-0000-4000-8000-000000000001', foreign = '11000000-0000-4000-8000-000000000002'
const client = '22000000-0000-4000-8000-000000000001', otherClient = '22000000-0000-4000-8000-000000000002'
const scope = { accountId: account, clientId: client }, wrong = { accountId: foreign, clientId: client }
const events: AnalyticsEvent[] = [{ eventId: 'event:0001', occurredAt: '2026-10-25T10:00:00Z', pageUrl: 'https://example.com/a', sessions: 3, conversions: 1, revenueMinor: 500, currency: 'HKD' }]

beforeAll(async () => {
  h.pg = await PGlite.create()
  await h.pg.exec(`create role aeo_app; alter default privileges in schema public grant select,insert,update,delete on tables to aeo_app;
    create table accounts(id uuid primary key);
    create table clients(id uuid primary key,account_id uuid references accounts(id),domain text,unique(id,account_id));
    create table profiles(id uuid primary key,account_id uuid references accounts(id));
    create table scans(id uuid primary key,account_id uuid,client_id uuid,url text,score numeric,results jsonb,created_at timestamptz default now());
    create table evidence_work_items(id uuid primary key,account_id uuid,client_id uuid);
  `)
  await h.pg.exec(readFileSync('supabase/migrations/071_outcome_integrations.sql', 'utf8'))
  await h.pg.exec(readFileSync('supabase/migrations/072_search_console_appearance.sql', 'utf8'))
})
afterAll(async () => { await h.pg?.close() })
beforeEach(async () => {
  await h.pg!.exec('truncate accounts cascade')
  await h.pg!.query('insert into accounts(id) values ($1),($2)', [account, foreign])
  await h.pg!.query('insert into clients(id,account_id,domain) values ($1,$2,$3),($4,$5,$6)', [client, account, 'example.com', otherClient, foreign, 'foreign.example'])
})

describe('real SQL outcome persistence and tenant boundaries', () => {
  it('replaces only an owned completed search-appearance window, including empty refreshes', async () => {
    const metrics = [{ date: '2026-10-25', pageUrl: 'https://example.com/a', appearance: 'RICH_RESULTS', clicks: 2, impressions: 10, ctr: 0.2, position: 4 }]
    const window = { startDate: '2026-10-01', endDate: '2026-10-26', pageUrls: ['https://example.com/a'] }
    expect(await writeSearchAppearance(account, client, metrics, window)).toBe(1)
    expect(await writeSearchAppearance(foreign, client, [], window)).toBe(0)
    expect((await h.pg!.query('select clicks from search_console_appearance')).rows).toEqual([{ clicks: 2 }])
    expect(await writeSearchAppearance(account, client, [], window)).toBe(0)
    expect((await h.pg!.query('select clicks from search_console_appearance')).rows).toEqual([])
  })
  it('removes inherited update/delete rights from append-only evidence and receipts', async () => {
    const rights = await h.pg!.query<{ events_update: boolean; events_delete: boolean; receipts_update: boolean; receipts_delete: boolean }>(`select
      has_table_privilege('aeo_app','outcome_events','UPDATE') as events_update,
      has_table_privilege('aeo_app','outcome_events','DELETE') as events_delete,
      has_table_privilege('aeo_app','outcome_attempt_receipts','UPDATE') as receipts_update,
      has_table_privilege('aeo_app','outcome_attempt_receipts','DELETE') as receipts_delete`)
    expect(rights.rows[0]).toEqual({ events_update: false, events_delete: false, receipts_update: false, receipts_delete: false })
  })
  it('stores analytics once and rejects changed replay data without partial writes', async () => {
    expect(await store.ingestAnalytics(scope, events)).toEqual({ accepted: 1, replayed: 0 })
    expect(await store.ingestAnalytics(scope, events)).toEqual({ accepted: 0, replayed: 1 })
    await expect(store.ingestAnalytics(scope, [{ ...events[0], conversions: 99 }, { ...events[0], eventId: 'event:0002' }])).rejects.toThrow('OUTCOME_INTENT_CONFLICT')
    const rows = await h.pg!.query('select event_key,conversions from outcome_events')
    expect(rows.rows).toEqual([{ event_key: 'event:0001', conversions: 1 }])
  })
  it('denies a foreign write/read even when the caller knows the client ID', async () => {
    await expect(store.ingestAnalytics(wrong, events)).rejects.toThrow('OUTCOME_NOT_FOUND')
    await store.ingestAnalytics(scope, events)
    expect(await store.readOutcomeData(wrong, { start: '2026-10-01', end: '2026-10-26' })).toBeNull()
  })
  it('stores explicit query clusters without allowing another tenant to address them', async () => {
    const cluster = await store.saveCluster(scope, { name: 'A', keywords: ['service'], targetUrl: 'https://example.com/a' })
    expect(cluster.name).toBe('A')
    await expect(store.saveCluster(wrong, { name: 'Foreign', keywords: ['x'], targetUrl: 'https://example.com/a' })).rejects.toThrow('OUTCOME_NOT_FOUND')
    const view = await store.readOutcomeData(scope, { start: '2026-10-01', end: '2026-10-26' })
    expect(view?.clusters).toHaveLength(1)
  })
  it('claims an external attempt once, persists a completion receipt and detects changed replays', async () => {
    const first = await store.beginOutcomeAttempt(scope, 'indexnow', 'submit:0001', { urls: ['https://example.com/a'] })
    expect(first.claimed).toBe(true)
    const repeat = await store.beginOutcomeAttempt(scope, 'indexnow', 'submit:0001', { urls: ['https://example.com/a'] })
    expect(repeat.claimed).toBe(false)
    expect(repeat.attempt.id).toBe(first.attempt.id)
    await store.finishOutcomeAttempt(scope, first.attempt.id, 'succeeded', 'INDEXNOW_ACCEPTED', 202)
    const done = await store.beginOutcomeAttempt(scope, 'indexnow', 'submit:0001', { urls: ['https://example.com/a'] })
    expect(done.attempt.status).toBe('succeeded')
    expect((await h.pg!.query('select id from outcome_attempt_receipts')).rows).toHaveLength(1)
    await expect(store.beginOutcomeAttempt(scope, 'indexnow', 'submit:0001', { urls: ['https://example.com/b'] })).rejects.toThrow('OUTCOME_INTENT_CONFLICT')
    await expect(store.finishOutcomeAttempt(wrong, first.attempt.id, 'failed', 'PROVIDER_FAILED', 500)).rejects.toThrow('OUTCOME_NOT_FOUND')
  })
  it('freezes deployment baselines and refuses foreign scan/work-item references', async () => {
    const scanId = '33000000-0000-4000-8000-000000000001'
    await h.pg!.query('insert into scans(id,account_id,client_id,url,score,results) values ($1,$2,$3,$4,70,$5)', [scanId, foreign, otherClient, 'https://foreign.example', '{}'])
    const input = { intentKey: 'deploy:0001', externalId: 'release-1', deployedAt: '2026-10-25T10:00:00Z', urls: ['https://example.com/a'], baselineScanId: scanId, workItemId: null }
    await expect(store.recordOutcomeDeployment(scope, input)).rejects.toThrow('OUTCOME_NOT_FOUND')
    const saved = await store.recordOutcomeDeployment(scope, { ...input, baselineScanId: null })
    expect(saved.externalId).toBe('release-1')
    expect((await store.recordOutcomeDeployment(scope, { ...input, baselineScanId: null })).id).toBe(saved.id)
  })
})
