import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { findUnguardedRoleStatements } from '../helpers/migration-role-guards.mjs'

// A manual allowlist: a migration missing from it is simply never checked, which
// is how 029 went unregistered. Add every new migration here.
const MIGRATIONS = [
  '023_public_scan_rate_limits.sql',
  '024_stripe_lifecycle_integrity.sql',
  '025_authenticated_scan_quotas.sql',
  '026_effective_brand_limit.sql',
  '027_client_report_snapshots.sql',
  '028_account_plan_overrides.sql',
  '029_scans_client_id.sql',
  '030_accounts_plan_default_basic.sql',
  '031_pulse_weekly_summary_unique.sql',
]

describe('Neon migration role portability', () => {
  it.each(MIGRATIONS)('%s guards Supabase-only role grants and revokes', async (name) => {
    const sql = await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')

    expect(findUnguardedRoleStatements(sql)).toEqual([])
  })
})
