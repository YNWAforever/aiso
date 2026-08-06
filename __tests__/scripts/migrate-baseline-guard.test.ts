import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertBaselined,
  listMigrationFiles,
  migrationCreatedTables,
  migrationDroppedTables,
  planMigrations,
  unappliedBaselineClaims,
} from '@/scripts/migrate'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

function sqlFor(filename: string) {
  return readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')
}

function entries(files: string[]) {
  return files.map(filename => {
    const sql = sqlFor(filename)
    return {
      filename,
      creates: migrationCreatedTables(sql),
      drops: migrationDroppedTables(sql),
    }
  })
}

/**
 * Every table the full migration set creates, verified by actually applying all
 * 29 files to a throwaway PostgreSQL 16 and reading information_schema. Kept as
 * a literal so the guard can be exercised without a database.
 */
const ALL_TABLES = [
  'account_report_branding', 'accounts', 'agent_competitors', 'agent_progress',
  'agent_recommendations', 'ai_citation_log', 'alert_configs',
  'authenticated_scan_monthly_usage', 'authority_overrides', 'authority_scores',
  'chunk_analysis', 'client_report_versions', 'client_reports', 'clients', 'content_briefs',
  'domain_signals', 'fix_packs', 'industry_packs', 'local_trust_actions', 'local_trust_profiles',
  'local_trust_snapshots', 'notifications', 'profiles', 'prompt_bank', 'public_scan_rate_limits',
  'pulse_metrics', 'pulse_weekly_summary', 'regional_packs', 'scans', 'schema_migrations',
  'stripe_subscription_processing_leases', 'stripe_webhook_events', 'topical_clusters'
]

describe('migrationCreatedTables', () => {
  it('finds tables in every DDL spelling the repo actually uses', () => {
    // lowercase `create table if not exists`, uppercase `CREATE TABLE IF NOT
    // EXISTS public.`, and 027's bare `create table` all appear in this repo.
    expect(migrationCreatedTables('create table if not exists pulse_metrics (')).toEqual(['pulse_metrics'])
    expect(migrationCreatedTables('CREATE TABLE IF NOT EXISTS public.notifications (')).toEqual(['notifications'])
    expect(migrationCreatedTables('create table client_reports (')).toEqual(['client_reports'])
  })

  it('ignores create table inside comments and dollar-quoted bodies', () => {
    // Otherwise a migration that merely mentions a table in prose would be
    // accused of failing to create it.
    expect(migrationCreatedTables('-- create table ghost (id uuid)')).toEqual([])
    expect(migrationCreatedTables('do $$ begin execute $x$ create table ghost (id uuid) $x$; end $$;'))
      .toEqual([])
  })

  it('attributes the local_trust tables to 021 and nothing else', () => {
    const owners = listMigrationFiles().filter(f =>
      migrationCreatedTables(sqlFor(f)).some(t => t.startsWith('local_trust')))

    expect(owners).toEqual(['021_local_trust_roi.sql'])
  })
})

describe('unappliedBaselineClaims', () => {
  it('passes a baseline whose tables all exist', () => {
    const files = listMigrationFiles()

    expect(unappliedBaselineClaims(entries(files), new Set(ALL_TABLES))).toEqual([])
  })

  it('refuses to record 021 when the local_trust tables are absent', () => {
    // The scenario the guard exists for. 021's own header says it "has never
    // been applied", while CLAUDE.md listed 001-026 as applied and its baseline
    // command excepted only 027/029/030/031 — so following the docs verbatim
    // would have recorded 021 as applied and permanently stranded these three
    // tables, which lib/localTrust/store.ts queries directly.
    const without021 = new Set(ALL_TABLES.filter(t => !t.startsWith('local_trust')))
    const claims = unappliedBaselineClaims(entries(listMigrationFiles()), without021)

    expect(claims.map(c => c.filename)).toEqual(['021_local_trust_roi.sql'])
    expect(claims[0].missing.sort()).toEqual([
      'local_trust_actions', 'local_trust_profiles', 'local_trust_snapshots',
    ])
  })

  it('says nothing about a migration excluded via --except', () => {
    // Pending migrations legitimately have no tables yet; excepting them is the
    // correct action, so they must not be reported.
    const files = listMigrationFiles().filter(f => f !== '027_client_report_snapshots.sql')
    const without027 = new Set(ALL_TABLES.filter(t => !t.startsWith('client_report')))

    expect(unappliedBaselineClaims(entries(files), without027)).toEqual([])
  })

  it('leaves migrations that create no tables unjudged', () => {
    // 030 only sets a column default; there is nothing to probe, and absence of
    // evidence must not read as evidence of absence.
    expect(migrationCreatedTables(sqlFor('030_accounts_plan_default_basic.sql'))).toEqual([])
    expect(unappliedBaselineClaims(
      entries(['030_accounts_plan_default_basic.sql']), new Set<string>(),
    )).toEqual([])
  })
})

describe('planMigrations', () => {
  it('returns the documented pending set given the documented ledger', () => {
    const files = listMigrationFiles()
    const claimedApplied = files.filter(f => ![
      '027_client_report_snapshots.sql', '029_scans_client_id.sql',
      '030_accounts_plan_default_basic.sql', '031_pulse_weekly_summary_unique.sql',
    ].includes(f))

    expect(planMigrations(files, claimedApplied)).toEqual([
      '027_client_report_snapshots.sql',
      '029_scans_client_id.sql',
      '030_accounts_plan_default_basic.sql',
      '031_pulse_weekly_summary_unique.sql',
    ])
  })
})

describe('assertBaselined', () => {
  // The one function here that can destroy production, and it had no coverage
  // of any kind. It is an AND of exactly two facts, and both edges matter.
  function pool(ledgerRows: number, hasAccounts: number) {
    return { query: async () => ({ rows: [{ ledger_rows: ledgerRows, has_accounts: hasAccounts }] }) }
  }

  it('refuses a populated database with an empty ledger', async () => {
    // Production before the runner existed: tables applied by hand, no ledger.
    // Proceeding would replay 001 onward over live data.
    await expect(assertBaselined(pool(0, 1) as never)).rejects.toThrow(/empty schema_migrations/)
  })

  it('allows a genuinely fresh database', async () => {
    // No accounts table and no ledger is the bootstrap path, not production.
    await expect(assertBaselined(pool(0, 0) as never)).resolves.toBeUndefined()
  })

  it('allows a database that has already been baselined', async () => {
    await expect(assertBaselined(pool(29, 1) as never)).resolves.toBeUndefined()
  })

  it('is disarmed by a single ledger row — which is why baselining is one statement', async () => {
    // Pins the sharp edge rather than pretending it away: the guard checks that
    // the ledger is EMPTY, so one row from a half-finished baseline lets a run
    // proceed against production. That is the reason --baseline inserts in a
    // single statement instead of a loop.
    await expect(assertBaselined(pool(1, 1) as never)).resolves.toBeUndefined()
  })

  it('points the operator at --verify rather than at a stale --except list', async () => {
    // The old message named only 027, which would have buried 029, 030 and 031.
    await expect(assertBaselined(pool(0, 1) as never)).rejects.toThrow(/--verify/)
  })
})
