import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Retainer OS Slice C1: migration 098 and lib/monthly-report/store.ts on real
 * Postgres (PGlite). client_reports / client_report_versions are minimal shapes
 * of 027's, with the same names for the columns and the version CHECK 098 replaces.
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

import { appendMonthlyReport, createMonthlyReport, loadMonthlyReport, loadOpenWorkItems, MonthlyReportExistsError } from '@/lib/monthly-report/store'
import type { MonthlyReportSnapshotV2 } from '@/lib/monthly-report/snapshot'

const account = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const client = '30000000-0000-4000-8000-000000000001'
const member = '20000000-0000-4000-8000-000000000001'
const q = async (text: string, values: unknown[] = []) => (await state.pg!.query(text, values)).rows as Record<string, unknown>[]
const snapshot = (summary = 'November: 1 change verified live.'): MonthlyReportSnapshotV2 => ({
  snapshotSchemaVersion: 2, kind: 'monthly', locale: 'en', month: '2026-11', period: { start: 'a', end: 'b' },
  branding: { agencyName: 'Fimmick', logoUrl: null, primaryColor: '#111827', contactLabel: null, contactUrl: null, attribution: 'Powered by Fimmick AISO' },
  client: { name: 'Bakery', domain: 'bakery.hk' }, delivered: { verifiedLive: [], selfReported: [] },
  visibility: { state: 'not_enough_data', reason: 'movement_rule_pending' },
  search: { opening: { state: 'not_connected' }, closing: { state: 'not_recorded' } }, nextMonth: { openWorkItems: [] },
  executiveSummary: summary, builtAt: '2026-12-04T00:00:00.000Z',
})
const write = (over: Record<string, unknown> = {}) => ({ accountId: account, clientId: client, locale: 'en' as const, narrative: 'November: 1 change verified live.',
  snapshot: snapshot(), actorId: member, ...over })

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table accounts(id uuid primary key);
    create table clients(id uuid primary key, account_id uuid not null, brand_name text, domain text, unique (id, account_id));
    create table client_reports(id uuid primary key default gen_random_uuid(), account_id uuid not null, client_id uuid not null,
      status text not null default 'draft', latest_version_id uuid, published_version_id uuid, created_by uuid,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, account_id, client_id));
    create table client_report_versions(id uuid primary key default gen_random_uuid(), report_id uuid not null, account_id uuid not null,
      client_id uuid not null, version_number integer not null, source_scan_id uuid, previous_scan_id uuid, locale text not null,
      executive_summary text not null, snapshot_schema_version integer not null check (snapshot_schema_version = 1),
      snapshot jsonb not null, created_by uuid, created_at timestamptz not null default now(), unique (report_id, version_number));
    create table evidence_work_items(id uuid primary key default gen_random_uuid(), account_id uuid, client_id uuid, title text,
      operation_status text, updated_at timestamptz);
  `)
  await state.pg.exec(readFileSync('supabase/migrations/098_monthly_client_reports.sql', 'utf8'))
  await q('insert into accounts values ($1), ($2)', [account, other])
  await q(`insert into clients values ($1, $2, 'Bakery', 'bakery.hk')`, [client, account])
})
beforeEach(async () => { await state.pg!.exec('update client_reports set latest_version_id = null; delete from client_report_versions; delete from client_reports; delete from evidence_work_items') })
afterAll(async () => { await state.pg?.close() })

describe('098 constraints', () => {
  it('keeps scan reports as they were, and ties kind to a first-of-month report_month', async () => {
    const [scan] = await q(`insert into client_reports (account_id, client_id) values ($1, $2) returning kind, report_month`, [account, client])
    expect(scan).toEqual({ kind: 'scan', report_month: null })
    await expect(q(`insert into client_reports (account_id, client_id, report_month) values ($1, $2, '2026-11-01')`, [account, client])).rejects.toThrow(/kind_check/)
    await expect(q(`insert into client_reports (account_id, client_id, kind) values ($1, $2, 'monthly')`, [account, client])).rejects.toThrow(/kind_check/)
    await expect(q(`insert into client_reports (account_id, client_id, kind, report_month) values ($1, $2, 'monthly', '2026-11-15')`, [account, client])).rejects.toThrow(/kind_check/)
    await expect(q(`insert into client_reports (account_id, client_id, kind, report_month) values ($1, $2, 'weekly', null)`, [account, client])).rejects.toThrow(/kind_check/)
  })

  it('allows schema 1 and 2 only, and a schema-2 version never names a scan', async () => {
    const [r] = await q(`insert into client_reports (account_id, client_id) values ($1, $2) returning id`, [account, client])
    const ins = (schema: number, scan: string | null, n: number) => q(`insert into client_report_versions (report_id, account_id, client_id, version_number,
      source_scan_id, locale, executive_summary, snapshot_schema_version, snapshot) values ($1, $2, $3, $4, $5, 'en', 's', $6, '{}')`, [r.id, account, client, n, scan, schema])
    await ins(1, null, 1)
    await ins(2, null, 2)
    await expect(ins(3, null, 3)).rejects.toThrow(/snapshot_schema_version_check/)
    await expect(ins(2, '40000000-0000-4000-8000-000000000001', 4)).rejects.toThrow(/monthly_shape_check/)
  })
})

describe('monthly report RPCs through the store', () => {
  it('creates one report per brand per month, then appends versions', async () => {
    expect(await createMonthlyReport({ ...write(), month: '2026-11-01' })).toEqual({ reportId: expect.any(String), versionNumber: 1 })
    await expect(createMonthlyReport({ ...write(), month: '2026-11-01' })).rejects.toBeInstanceOf(MonthlyReportExistsError)
    const first = await loadMonthlyReport(account, client, '2026-11-01')
    expect(first).toMatchObject({ status: 'draft', versionNumber: 1, snapshot: { kind: 'monthly', executiveSummary: 'November: 1 change verified live.' } })
    expect(await appendMonthlyReport({ ...write({ narrative: 'Rewritten.', snapshot: snapshot('Rewritten.') }), reportId: first!.reportId }))
      .toEqual({ reportId: first!.reportId, versionNumber: 2 })
    expect((await loadMonthlyReport(account, client, '2026-11-01'))!.snapshot.executiveSummary).toBe('Rewritten.')
    expect(await q('select kind, report_month::text from client_reports')).toEqual([{ kind: 'monthly', report_month: '2026-11-01' }])
    expect(await q('select version_number, snapshot_schema_version, source_scan_id from client_report_versions order by version_number'))
      .toEqual([{ version_number: 1, snapshot_schema_version: 2, source_scan_id: null }, { version_number: 2, snapshot_schema_version: 2, source_scan_id: null }])
  })

  it('refuses another account\'s brand, a mid-month date, and appending to a scan report', async () => {
    await expect(createMonthlyReport({ ...write({ accountId: other }), month: '2026-11-01' })).rejects.toThrow(/CLIENT_REPORT_NOT_FOUND/)
    await expect(createMonthlyReport({ ...write(), month: '2026-11-02' })).rejects.toThrow(/CLIENT_REPORT_MONTH_INVALID/)
    const [scan] = await q(`insert into client_reports (account_id, client_id) values ($1, $2) returning id`, [account, client])
    await expect(appendMonthlyReport({ ...write(), reportId: String(scan.id) })).rejects.toThrow(/CLIENT_REPORT_NOT_FOUND/)
    const { reportId } = await createMonthlyReport({ ...write(), month: '2026-11-01' })
    await expect(appendMonthlyReport({ ...write({ accountId: other }), reportId })).rejects.toThrow(/CLIENT_REPORT_NOT_FOUND/)
    expect(await loadMonthlyReport(other, client, '2026-11-01')).toBeNull()
    expect(await loadMonthlyReport(account, client, '2026-10-01')).toBeNull()
  })

  it('lists only open work items of this brand for next month', async () => {
    await q(`insert into evidence_work_items (account_id, client_id, title, operation_status, updated_at) values
      ($1, $2, 'Add FAQ', 'todo', '2026-11-03'), ($1, $2, 'Shipped', 'done', '2026-11-04'), ($3, $2, 'Foreign', 'todo', '2026-11-05')`, [account, client, other])
    expect(await loadOpenWorkItems(account, client)).toEqual([{ title: 'Add FAQ' }])
  })
})
