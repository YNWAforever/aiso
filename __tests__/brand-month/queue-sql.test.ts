import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Retainer OS Slice B: lib/brand-month/queue.ts on real Postgres (PGlite), with
 * migration 097 and minimal shapes of the source tables. Dates are in 2025 so
 * 097's `as_of <= taken_at` CHECK holds against the real clock.
 */

const state = vi.hoisted(() => ({ pg: null as PGlite | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => {
  const run = async (text: string, values: unknown[]) => (await state.pg!.query(text, values)).rows
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? '$' + index : '') + part, '')
    return { text, values, then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => run(text, values).then(ok, ko) }
  }
  return { db: () => tag }
})

import { loadDueMonthBrands, readMonthQueue } from '@/lib/brand-month/queue'

const account = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const bakery = '30000000-0000-4000-8000-000000000001'
const cafe = '30000000-0000-4000-8000-000000000002'
const foreign = '30000000-0000-4000-8000-000000000003'
const item = '40000000-0000-4000-8000-000000000001'
const v1 = '50000000-0000-4000-8000-000000000001', v2 = '50000000-0000-4000-8000-000000000002'
const job = '60000000-0000-4000-8000-000000000001'
const NOW = new Date('2025-11-06T04:00:00Z')
const q = async (text: string, values: unknown[] = []) => (await state.pg!.query(text, values)).rows as Record<string, unknown>[]
const row = async (clientId: string, now = NOW) => (await readMonthQueue(account, now)).find(r => r.clientId === clientId)!

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table accounts(id uuid primary key, plan text, status text, stripe_subscription_id text, trial_ends_at timestamptz,
      override_plan text, override_expires_at timestamptz);
    create table clients(id uuid primary key, account_id uuid not null references accounts(id), brand_name text, domain text, unique (id, account_id));
    create table work_item_versions(id uuid primary key, account_id uuid, client_id uuid, work_item_id uuid, version_number int, content_hash text);
    create table work_item_decisions(id uuid primary key default gen_random_uuid(), account_id uuid, client_id uuid, version_id uuid, content_hash text, decision text);
    create table site_edit_jobs(id uuid primary key, account_id uuid, client_id uuid);
    create table site_edit_job_events(job_id uuid, account_id uuid, seq int, kind text, created_at timestamptz);
    create table site_edit_receipts(job_id uuid, account_id uuid, status text);
    create table work_item_delivery_events(id uuid primary key default gen_random_uuid(), account_id uuid, kind text, site_edit_job_id uuid, target_attestation_id uuid);
    create table prompt_bank(id uuid primary key default gen_random_uuid(), client_id uuid, is_active boolean);
    create table pulse_weekly_summary(client_id uuid, scan_week date, platform text);
    create table search_console_bindings(account_id uuid, client_id uuid, bound_at timestamptz);
    create table search_console_daily(account_id uuid, client_id uuid, synced_at timestamptz);
  `)
  await state.pg.exec(readFileSync('supabase/migrations/097_brand_month_snapshots.sql', 'utf8'))
  await q(`insert into accounts values ($1, 'pro', 'active', 'sub_1', null, null, null), ($2, 'free', 'active', null, null, null, null)`, [account, other])
  await q(`insert into clients values ($1, $2, 'Bakery', 'bakery.hk'), ($3, $2, 'Cafe', 'cafe.hk'), ($4, $5, 'Foreign', 'f.hk')`, [bakery, account, cafe, foreign, other])
})

beforeEach(async () => {
  await state.pg!.exec(`delete from work_item_versions; delete from work_item_decisions; delete from site_edit_jobs; delete from site_edit_job_events;
    delete from site_edit_receipts; delete from work_item_delivery_events; delete from prompt_bank; delete from pulse_weekly_summary;
    delete from search_console_bindings; delete from search_console_daily; delete from brand_month_snapshots`)
})
afterAll(async () => { await state.pg?.close() })

describe('readMonthQueue', () => {
  it('lists only this account\'s brands, in name order', async () => {
    expect((await readMonthQueue(account, NOW)).map(r => r.brandName)).toEqual(['Bakery', 'Cafe'])
  })

  it('counts an approval as waiting only on a work item\'s latest version', async () => {
    await q(`insert into work_item_versions values ($1, $2, $3, $4, 1, 'h1'), ($5, $2, $3, $4, 2, 'h2')`, [v1, account, bakery, item, v2])
    await q(`insert into work_item_decisions (account_id, client_id, version_id, content_hash, decision) values ($1, $2, $3, 'h1', 'approved')`, [account, bakery, v1])
    expect((await row(bakery)).approvalsWaiting).toBe(1)
    await q(`insert into work_item_decisions (account_id, client_id, version_id, content_hash, decision) values ($1, $2, $3, 'h2', 'changes_requested')`, [account, bakery, v2])
    expect((await row(bakery)).approvalsWaiting).toBe(0)
  })

  it('keeps a sent edit unverified until a standing verified attestation, and drops a refused one', async () => {
    await q('insert into site_edit_jobs values ($1, $2, $3)', [job, account, bakery])
    await q(`insert into site_edit_job_events values ($1, $2, 1, 'claim', '2025-11-03'), ($1, $2, 2, 'sent', '2025-11-03')`, [job, account])
    expect((await row(bakery)).editsUnverified).toBe(1)
    const [att] = await q(`insert into work_item_delivery_events (account_id, kind, site_edit_job_id) values ($1, 'attest', $2) returning id`, [account, job])
    expect((await row(bakery)).editsUnverified).toBe(0)
    await q(`insert into work_item_delivery_events (account_id, kind, target_attestation_id) values ($1, 'withdraw', $2)`, [account, att.id])
    expect((await row(bakery)).editsUnverified).toBe(1)
    await q(`insert into site_edit_receipts values ($1, $2, 'rejected')`, [job, account])
    expect((await row(bakery)).editsUnverified).toBe(0)
  })

  it('counts sends with the cap\'s own rule, this Hong Kong month only', async () => {
    for (let i = 0; i < 8; i++) {
      const id = `60000000-0000-4000-8000-00000000010${i}`
      await q('insert into site_edit_jobs values ($1, $2, $3)', [id, account, bakery])
      await q(`insert into site_edit_job_events values ($1, $2, 1, 'claim', '2025-11-02'), ($1, $2, 2, $3, '2025-11-02')`, [id, account, i < 7 ? 'sent' : 'failed'])
    }
    await q('insert into site_edit_jobs values ($1, $2, $3)', [job, account, bakery])
    await q(`insert into site_edit_job_events values ($1, $2, 1, 'claim', '2025-10-31T15:00:00Z')`, [job, account])
    expect(await row(bakery)).toMatchObject({ monthSends: 7, nearCap: false })
    await q(`insert into site_edit_job_events values ($1, $2, 2, 'claim', '2025-11-04')`, [job, account])
    expect(await row(bakery)).toMatchObject({ monthSends: 8, nearCap: true })
  })

  it('calls Pulse overdue only for a brand that has active questions', async () => {
    expect(await row(bakery)).toMatchObject({ activeQuestions: 0, pulseOverdue: false, lastPulseWeek: null })
    await q('insert into prompt_bank (client_id, is_active) values ($1, true)', [bakery])
    expect((await row(bakery)).pulseOverdue).toBe(true)
    await q(`insert into pulse_weekly_summary values ($1, '2025-10-20', 'gpt-4o')`, [bakery])
    expect(await row(bakery)).toMatchObject({ pulseOverdue: true, lastPulseWeek: '2025-10-20' })
    await q(`insert into pulse_weekly_summary values ($1, '2025-10-27', 'gpt-4o'), ($1, '2025-11-03', null)`, [bakery])
    expect(await row(bakery)).toMatchObject({ pulseOverdue: false, lastPulseWeek: '2025-10-27' })
  })

  it('reads Search Console as not connected, stale or fresh under the current binding', async () => {
    expect((await row(bakery)).searchConsole).toBe('not_connected')
    await q(`insert into search_console_bindings values ($1, $2, '2025-10-01')`, [account, bakery])
    await q(`insert into search_console_daily values ($1, $2, '2025-09-30')`, [account, bakery])
    expect(await row(bakery)).toMatchObject({ searchConsole: 'stale', lastSync: null })
    await q(`insert into search_console_daily values ($1, $2, '2025-11-01')`, [account, bakery])
    expect((await row(bakery)).searchConsole).toBe('stale')
    await q(`insert into search_console_daily values ($1, $2, '2025-11-05')`, [account, bakery])
    expect(await row(bakery)).toMatchObject({ searchConsole: 'ok', lastSync: '2025-11-05T00:00:00.000Z' })
  })

  it('flags a missing opening, and last month\'s closing only once it is due', async () => {
    expect((await row(bakery)).snapshotsPending).toBe(true)
    await q(`insert into brand_month_snapshots (account_id, client_id, month, kind, as_of, figures) values ($1, $2, '2025-11-01', 'opening', '2025-10-31T16:00:00Z', '{}')`, [account, bakery])
    expect((await row(bakery, new Date('2025-11-03T00:00:00Z'))).snapshotsPending).toBe(false)
    expect((await row(bakery)).snapshotsPending).toBe(true)
    await q(`insert into brand_month_snapshots (account_id, client_id, month, kind, as_of, figures) values ($1, $2, '2025-10-01', 'closing', '2025-10-31T16:00:00Z', '{}')`, [account, bakery])
    expect((await row(bakery)).snapshotsPending).toBe(false)
  })
})

describe('loadDueMonthBrands', () => {
  it('selects brands of every account missing a due snapshot, with the account fields entitlement needs', async () => {
    const due = await loadDueMonthBrands(NOW, 10)
    expect(due.map(d => d.clientId).sort()).toEqual([bakery, cafe, foreign].sort())
    expect(due.find(d => d.clientId === foreign)!.account).toMatchObject({ plan: 'free', status: 'active' })
    for (const [month, kind, asOf] of [['2025-11-01', 'opening', '2025-10-31T16:00:00Z'], ['2025-10-01', 'closing', '2025-10-31T16:00:00Z']]) {
      await q(`insert into brand_month_snapshots (account_id, client_id, month, kind, as_of, figures) values ($1, $2, $3, $4, $5, '{}')`, [account, bakery, month, kind, asOf])
    }
    expect((await loadDueMonthBrands(NOW, 10)).map(d => d.clientId)).not.toContain(bakery)
    expect(await loadDueMonthBrands(NOW, 1)).toHaveLength(1)
  })
})
