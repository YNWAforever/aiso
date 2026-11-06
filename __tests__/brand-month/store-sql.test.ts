import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Retainer OS Slice B: migration 097 and lib/brand-month/store.ts on real
 * Postgres (PGlite). Source tables are minimal shapes of the real ones; the
 * Search Console binding lookup is stubbed (its own suite covers it).
 */

const state = vi.hoisted(() => ({ pg: null as PGlite | null, binding: null as null | { boundAt: string; currentDomain: string }, matches: true }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => {
  const run = async (text: string, values: unknown[]) => (await state.pg!.query(text, values)).rows
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? '$' + index : '') + part, '')
    return { text, values, then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => run(text, values).then(ok, ko) }
  }
  return { db: () => tag }
})
vi.mock('@/lib/integrations/search-console/store', () => ({ loadBinding: vi.fn(async () => state.binding) }))
vi.mock('@/lib/integrations/search-console/binding', () => ({ bindingMatchesDomain: vi.fn(() => state.matches) }))

import { computeFigures, readActivity, readBrandMonth, recordDueSnapshots } from '@/lib/brand-month/store'
import { periodOf } from '@/lib/brand-month/period'

const account = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const client = '30000000-0000-4000-8000-000000000001'
const foreign = '30000000-0000-4000-8000-000000000002'
const item = '40000000-0000-4000-8000-000000000001'
const job = '60000000-0000-4000-8000-000000000001'
const nov = periodOf('2025-11')!
const q = async (text: string, values: unknown[] = []) => (await state.pg!.query(text, values)).rows as Record<string, unknown>[]

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table accounts(id uuid primary key);
    create table clients(id uuid primary key, account_id uuid not null references accounts(id), brand_name text, domain text, unique (id, account_id));
    create table scans(id uuid primary key default gen_random_uuid(), account_id uuid, client_id uuid, score numeric(5,2), created_at timestamptz);
    create table pulse_weekly_summary(id uuid primary key default gen_random_uuid(), client_id uuid, scan_week date, platform text,
      total_queries int, brand_mentions int, sov_score numeric(5,2), created_at timestamptz default now());
    create table search_console_bindings(account_id uuid, client_id uuid, bound_at timestamptz);
    create table search_console_daily(account_id uuid, client_id uuid, date date, scope text, clicks int, impressions int, synced_at timestamptz);
    create table evidence_work_items(id uuid primary key, account_id uuid, client_id uuid, title text, created_at timestamptz);
    create table visibility_completion_events(account_id uuid, client_id uuid, work_item_id uuid, completed_at timestamptz);
    create table site_edit_jobs(id uuid primary key, account_id uuid, client_id uuid);
    create table site_edit_job_events(job_id uuid, account_id uuid, kind text, created_at timestamptz);
    create table site_edit_receipts(job_id uuid, account_id uuid, status text, received_at timestamptz);
    create table work_item_delivery_events(id uuid primary key default gen_random_uuid(), account_id uuid, client_id uuid, work_item_id uuid,
      version_id uuid default gen_random_uuid(), kind text, provenance text default 'self_reported', site_edit_job_id uuid,
      target_attestation_id uuid, recorded_at timestamptz);
  `)
  await state.pg.exec(readFileSync('supabase/migrations/097_brand_month_snapshots.sql', 'utf8'))
  await q('insert into accounts values ($1), ($2)', [account, other])
  await q(`insert into clients values ($1, $2, 'Bakery', 'bakery.hk'), ($3, $4, 'Other', 'other.hk')`, [client, account, foreign, other])
})

beforeEach(async () => {
  state.binding = { boundAt: '2025-09-01T00:00:00Z', currentDomain: 'bakery.hk' }; state.matches = true
  await state.pg!.exec(`delete from brand_month_snapshots; delete from scans; delete from pulse_weekly_summary; delete from search_console_bindings;
    delete from search_console_daily; delete from evidence_work_items; delete from visibility_completion_events; delete from site_edit_jobs;
    delete from site_edit_job_events; delete from site_edit_receipts; delete from work_item_delivery_events`)
  await q('insert into search_console_bindings values ($1, $2, $3)', [account, client, state.binding.boundAt])
})
afterAll(async () => { await state.pg?.close() })

describe('097 brand_month_snapshots', () => {
  const insert = (asOf: string, kind = 'opening', month = '2025-11-01') => q(
    `insert into brand_month_snapshots (account_id, client_id, month, kind, as_of, figures) values ($1, $2, $3, $4, $5, '{}')`, [account, client, month, kind, asOf])

  it('pins each boundary to the Hong Kong midnight its month and kind imply', async () => {
    await insert(nov.start)
    await insert(nov.end, 'closing')
    await expect(insert('2025-11-01T00:00:00Z', 'opening', '2025-12-01')).rejects.toThrow(/shape_check/)
    await insert(nov.start, 'closing', '2025-10-01')
    await expect(insert(nov.start, 'opening', '2025-10-01')).rejects.toThrow(/shape_check/)
    await expect(insert('2025-11-15T16:00:00Z', 'opening', '2025-11-15')).rejects.toThrow(/shape_check/)
    await expect(insert(nov.start, 'midpoint', '2025-10-01')).rejects.toThrow(/kind_check/)
  })

  it('holds one snapshot per brand, month and kind, and refuses a boundary in the future', async () => {
    await insert(nov.start)
    await expect(insert(nov.start)).rejects.toThrow(/duplicate key/)
    await expect(insert('2099-12-31T16:00:00Z', 'opening', '2100-01-01')).rejects.toThrow(/shape_check/)
  })
})

describe('figures as of a boundary', () => {
  it('reads only rows from before the boundary, the latest completed Pulse week, and the 28 days before it', async () => {
    await q(`insert into scans (account_id, client_id, score, created_at) values ($1, $2, 61, '2025-10-20T00:00:00Z'), ($1, $2, 70, '2025-11-02T00:00:00Z'),
      ($3, $4, 99, '2025-10-30T00:00:00Z')`, [account, client, other, foreign])
    // Week of 2025-10-26 ends on 2025-11-02 HK, after the boundary: not complete yet. 2025-10-19 is the latest complete week.
    await q(`insert into pulse_weekly_summary (client_id, scan_week, platform, total_queries, brand_mentions, sov_score, created_at) values
      ($1, '2025-10-19', 'gpt-4o', 10, 3, 30, '2025-10-26'), ($1, '2025-10-19', 'gpt-4o', 10, 4, 40, '2025-10-27'),
      ($1, '2025-10-19', 'gemini-flash', 10, 1, 10, '2025-10-26'), ($1, '2025-10-19', null, 20, 5, 25, '2025-10-26'),
      ($1, '2025-10-26', 'gpt-4o', 10, 9, 90, '2025-11-02'), ($2, '2025-10-19', 'gpt-4o', 10, 10, 100, '2025-10-26')`, [client, foreign])
    await q(`insert into search_console_daily values ($1, $2, '2025-10-03', 'property', 5, 100, '2025-10-05'), ($1, $2, '2025-10-31', 'property', 7, 200, '2025-11-01'),
      ($1, $2, '2025-10-02', 'property', 1000, 1000, '2025-10-05'), ($1, $2, '2025-11-01', 'property', 1000, 1000, '2025-11-02'),
      ($1, $2, '2025-10-10', 'page', 1000, 1000, '2025-10-12'), ($1, $2, '2025-10-11', 'property', 1000, 1000, '2025-08-01')`, [account, client])
    const figures = await computeFigures(account, client, nov.start)
    expect(figures.scan).toMatchObject({ state: 'ok', score: 61, recordedAt: '2025-10-20T00:00:00.000Z' })
    expect(figures.pulse).toEqual({ state: 'ok', week: '2025-10-19', platforms: [
      { platform: 'gemini-flash', sovScore: 10, totalQueries: 10, brandMentions: 1 },
      { platform: 'gpt-4o', sovScore: 40, totalQueries: 10, brandMentions: 4 },
    ] })
    expect(figures.search).toEqual({ state: 'ok', from: '2025-10-04', through: '2025-10-31', days: 1, clicks: 7, impressions: 200 })
  })

  it('stores a missing source as none and an unbound one as not connected, never as zero', async () => {
    expect(await computeFigures(account, client, nov.start)).toEqual({ version: 1, scan: { state: 'none' }, pulse: { state: 'none' },
      search: { state: 'none', from: '2025-10-04', through: '2025-10-31' } })
    state.matches = false
    expect((await computeFigures(account, client, nov.start)).search).toEqual({ state: 'not_connected' })
    state.binding = null
    expect((await computeFigures(account, client, nov.start)).search).toEqual({ state: 'not_connected' })
  })

  it('never reads another account\'s rows through a client id', async () => {
    await q(`insert into scans (account_id, client_id, score, created_at) values ($1, $2, 99, '2025-10-30T00:00:00Z')`, [other, client])
    await q(`insert into pulse_weekly_summary (client_id, scan_week, platform, sov_score) values ($1, '2025-10-12', 'gpt-4o', 99)`, [client])
    expect((await computeFigures(other, client, nov.start)).scan).toEqual({ state: 'ok', scanId: expect.any(String), score: 99, recordedAt: '2025-10-30T00:00:00.000Z' })
    expect((await computeFigures(other, client, nov.start)).pulse).toEqual({ state: 'none' })
    expect((await computeFigures(account, client, nov.start)).scan).toEqual({ state: 'none' })
  })
})

describe('activity in the month', () => {
  it('counts only this brand\'s rows inside the Hong Kong month, and keeps verified and self-reported apart', async () => {
    await q(`insert into evidence_work_items values ($1, $2, $3, 'Add FAQ schema', '2025-11-03T00:00:00Z'),
      (gen_random_uuid(), $2, $3, 'Before', '2025-10-31T15:59:59Z'), (gen_random_uuid(), $2, $3, 'First minute', '2025-10-31T16:00:00Z'),
      (gen_random_uuid(), $4, $5, 'Foreign', '2025-11-03T00:00:00Z')`, [item, account, client, other, foreign])
    await q(`insert into visibility_completion_events values ($1, $2, $3, '2025-11-10'), ($1, $2, $3, '2025-11-11')`, [account, client, item])
    await q('insert into site_edit_jobs values ($1, $2, $3)', [job, account, client])
    await q(`insert into site_edit_job_events values ($1, $2, 'claim', '2025-11-04'), ($1, $2, 'sent', '2025-11-04'), ($1, $2, 'sent', '2025-11-05')`, [job, account])
    await q(`insert into site_edit_receipts values ($1, $2, 'completed', '2025-11-06')`, [job, account])
    const [verified] = await q(`insert into work_item_delivery_events (account_id, client_id, work_item_id, kind, provenance, site_edit_job_id, recorded_at)
      values ($1, $2, $3, 'attest', 'verified_live', $4, '2025-11-06T01:00:00Z') returning id`, [account, client, item, job])
    const [self] = await q(`insert into work_item_delivery_events (account_id, client_id, work_item_id, kind, recorded_at)
      values ($1, $2, $3, 'attest', '2025-11-07') returning id`, [account, client, item])
    const [withdrawn] = await q(`insert into work_item_delivery_events (account_id, client_id, work_item_id, kind, recorded_at)
      values ($1, $2, $3, 'attest', '2025-11-08') returning id`, [account, client, item])
    await q(`insert into work_item_delivery_events (account_id, client_id, work_item_id, kind, target_attestation_id, recorded_at)
      values ($1, $2, $3, 'withdraw', $4, '2025-11-09')`, [account, client, item, withdrawn.id])
    const a = await readActivity(account, client, nov)
    expect(a).toMatchObject({ workItemsOpened: 2, workItemsDone: 1, siteEditsSent: 1, receiptsCompleted: 1, receiptsRejected: 0 })
    expect(a.verifiedLive).toEqual([{ attestationId: verified.id, workItemId: item, title: 'Add FAQ schema', versionId: expect.any(String),
      recordedAt: '2025-11-06T01:00:00.000Z', siteEditJobId: job }])
    expect(a.selfReported.map(d => d.attestationId)).toEqual([self.id])
    expect(await readActivity(other, client, nov)).toEqual({ workItemsOpened: 0, workItemsDone: 0, siteEditsSent: 0,
      receiptsCompleted: 0, receiptsRejected: 0, verifiedLive: [], selfReported: [] })
  })
})

describe('recording snapshots', () => {
  it('records only what is due, once, and never rewrites it', async () => {
    await q(`insert into scans (account_id, client_id, score, created_at) values ($1, $2, 61, '2025-10-20T00:00:00Z')`, [account, client])
    expect(await recordDueSnapshots(account, client, nov, new Date('2025-11-06T00:00:00Z'))).toEqual({ state: 'ok', recorded: ['opening'] })
    await q(`insert into scans (account_id, client_id, score, created_at) values ($1, $2, 50, '2025-10-25T00:00:00Z')`, [account, client])
    expect(await recordDueSnapshots(account, client, nov, new Date('2025-11-07T00:00:00Z'))).toEqual({ state: 'ok', recorded: [] })
    expect(await recordDueSnapshots(account, client, nov, new Date('2025-12-04T00:00:00Z'))).toEqual({ state: 'ok', recorded: ['closing'] })
    const month = await readBrandMonth(account, client, nov)
    expect(month.state === 'ok' && month.snapshots.map(s => [s.kind, s.asOf, (s.figures.scan as { score: number }).score])).toEqual([
      ['opening', nov.start, 61], ['closing', nov.end, 50]])
  })

  it('records nothing for, and shows nothing of, another account\'s brand', async () => {
    expect(await recordDueSnapshots(other, client, nov, new Date('2025-12-31T00:00:00Z'))).toEqual({ state: 'not_found' })
    expect(await readBrandMonth(other, client, nov)).toEqual({ state: 'not_found' })
    expect(await q('select count(*)::int as n from brand_month_snapshots')).toEqual([{ n: 0 }])
  })
})
