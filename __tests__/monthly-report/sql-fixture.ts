import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync } from 'node:fs'
import type { MonthlyReportSnapshotV2 } from '@/lib/monthly-report/snapshot'

export const ACCOUNT = '10000000-0000-4000-8000-000000000001'
export const OTHER_ACCOUNT = '10000000-0000-4000-8000-000000000002'
export const MEMBER = '20000000-0000-4000-8000-000000000001'
export const OTHER_MEMBER = '20000000-0000-4000-8000-000000000002'
export const CLIENT = '30000000-0000-4000-8000-000000000001'
export const FOREIGN_CLIENT = '30000000-0000-4000-8000-000000000002'
export const SECOND_CLIENT = '30000000-0000-4000-8000-000000000003'
export const ITEM = '40000000-0000-4000-8000-000000000001'
export const VERSION = '50000000-0000-4000-8000-000000000001'

/** Real 027 (including pgcrypto), 097 and 098; only upstream source tables are reduced fixtures. */
export async function reportDatabase(cap: 65536 | 262144 = 262144): Promise<PGlite> {
  const pg = await PGlite.create({ extensions: { pgcrypto } })
  await pg.exec(`
    create table accounts(id uuid primary key, plan text default 'pro', status text default 'active',
      stripe_subscription_id text default 'sub_fixture', trial_ends_at timestamptz,
      override_plan text, override_expires_at timestamptz);
    create table clients(id uuid primary key, account_id uuid not null references accounts(id), brand_name text, domain text);
    create table profiles(id uuid primary key, account_id uuid not null references accounts(id));
    create table scans(id uuid primary key default gen_random_uuid(), account_id uuid, client_id uuid,
      domain text, score numeric, created_at timestamptz default now());
    create table evidence_work_items(id uuid primary key default gen_random_uuid(), account_id uuid, client_id uuid,
      title text, operation_status text default 'todo', created_at timestamptz default now(), updated_at timestamptz default now());
    create table visibility_completion_events(account_id uuid, client_id uuid, work_item_id uuid, completed_at timestamptz);
    create table site_edit_jobs(id uuid primary key, account_id uuid, client_id uuid);
    create table site_edit_job_events(job_id uuid, account_id uuid, kind text, created_at timestamptz);
    create table site_edit_receipts(job_id uuid, account_id uuid, status text, received_at timestamptz);
    create table work_item_delivery_events(id uuid primary key default gen_random_uuid(), account_id uuid, client_id uuid,
      work_item_id uuid, version_id uuid, kind text, provenance text, site_edit_job_id uuid,
      target_attestation_id uuid, recorded_at timestamptz);
    create table pulse_weekly_summary(id uuid primary key default gen_random_uuid(), client_id uuid references clients(id),
      scan_week date not null, platform text, total_queries int, brand_mentions int, sov_score numeric(5,2),
      avg_sentiment_score numeric(3,2), top_competitors jsonb, created_at timestamptz default now());
  `)
  await pg.exec(readFileSync('supabase/migrations/027_client_report_snapshots.sql', 'utf8'))
  await pg.exec(readFileSync('supabase/migrations/097_brand_month_snapshots.sql', 'utf8'))
  const migration = readFileSync('supabase/migrations/098_monthly_client_reports.sql', 'utf8')
  if (migration.split('octet_length(snapshot::text) <= 262144').length !== 2) {
    throw new Error('Expected exactly one file-schema size predicate')
  }
  // Reproduce the queried production CHECK in memory; never edit or apply a migration remotely.
  await pg.exec(cap === 65536 ? migration.replace('<= 262144', '<= 65536') : migration)
  await pg.query('insert into accounts(id) values ($1), ($2)', [ACCOUNT, OTHER_ACCOUNT])
  await pg.query('insert into profiles values ($1, $2), ($3, $4)', [MEMBER, ACCOUNT, OTHER_MEMBER, OTHER_ACCOUNT])
  await pg.query(`insert into clients values ($1, $2, 'Fixture Bakery', 'bakery.example'),
    ($3, $4, 'Foreign sentinel', 'foreign.example'),
    ($5, $2, 'Second brand', 'second.example')`, [CLIENT, ACCOUNT, FOREIGN_CLIENT, OTHER_ACCOUNT, SECOND_CLIENT])
  await pg.query(`insert into account_report_branding(account_id, agency_name, primary_color)
    values ($1, 'Fixture Agency', '#123ABC')`, [ACCOUNT])
  return pg
}

export function monthlySnapshot(): MonthlyReportSnapshotV2 {
  return {
    snapshotSchemaVersion: 2, kind: 'monthly', locale: 'en', month: '2026-10',
    period: { start: '2026-09-30T16:00:00.000Z', end: '2026-10-31T16:00:00.000Z' },
    branding: { agencyName: 'Fixture Agency', logoUrl: null, primaryColor: '#123ABC', contactLabel: null,
      contactUrl: null, attribution: 'Powered by Fimmick AISO' },
    client: { name: 'Fixture Bakery', domain: 'bakery.example' },
    delivered: { verifiedLive: [], selfReported: [] },
    visibility: { state: 'not_enough_data', reason: 'movement_rule_pending' },
    search: { opening: { state: 'not_connected' }, closing: { state: 'not_recorded' } },
    nextMonth: { openWorkItems: [] }, executiveSummary: 'Stored fixture narrative.',
    builtAt: '2026-11-07T08:57:00.000Z',
  }
}

/** Size the value using PostgreSQL's JSONB serializer, including spaces and UTF-8 bytes. */
export async function snapshotAtBytes(pg: PGlite, bytes: number) {
  const base = { ...monthlySnapshot(), unicode: '\u9999\u6e2f', padding: '' }
  const { rows: [size] } = await pg.query<{ bytes: number }>(
    'select octet_length($1::jsonb::text) as bytes', [JSON.stringify(base)])
  const snapshot = { ...base, padding: 'x'.repeat(bytes - size.bytes) }
  const { rows: [measured] } = await pg.query<{ bytes: number }>(
    'select octet_length($1::jsonb::text) as bytes', [JSON.stringify(snapshot)])
  if (measured.bytes !== bytes) throw new Error('PostgreSQL boundary fixture is not exact')
  return snapshot
}
