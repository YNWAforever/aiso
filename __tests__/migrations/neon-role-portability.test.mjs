import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { findUnguardedRoleStatements } from '../helpers/migration-role-guards.mjs'

/**
 * Every migration, read from disk.
 *
 * This was a hand-maintained array starting at 023, and its own comment conceded
 * the flaw: "a migration missing from it is simply never checked, which is how
 * 029 went unregistered". The array had two failure modes — a new migration
 * added without registering it, and the twenty-two older files that were never
 * in scope at all. Both are closed by reading the directory, and there is now
 * nothing to remember when adding a migration.
 */
const MIGRATIONS = readdirSync(new URL('../../supabase/migrations', import.meta.url))
  .filter(f => f.endsWith('.sql'))
  .sort()

describe('Neon migration role portability', () => {
  it('scans every migration on disk, not a hand-maintained subset', () => {
    // Pins the mechanism itself: reverting to a literal list would silently
    // shrink coverage back, which is exactly what happened before.
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(29)
    expect(MIGRATIONS).toContain('001_phase1.sql')
    expect(MIGRATIONS).toContain('031_pulse_weekly_summary_unique.sql')
  })

  it.each(MIGRATIONS)('%s guards Supabase-only role grants and revokes', async (name) => {
    const sql = await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')

    expect(findUnguardedRoleStatements(sql)).toEqual([])
  })
})
