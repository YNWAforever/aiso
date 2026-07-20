import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { findUnguardedRoleStatements } from '../helpers/migration-role-guards.mjs'

const MIGRATIONS = [
  '023_public_scan_rate_limits.sql',
  '024_stripe_lifecycle_integrity.sql',
  '025_authenticated_scan_quotas.sql',
  '026_effective_brand_limit.sql',
]

describe('Neon migration role portability', () => {
  it.each(MIGRATIONS)('%s guards Supabase-only role grants and revokes', async (name) => {
    const sql = await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')

    expect(findUnguardedRoleStatements(sql)).toEqual([])
  })
})
