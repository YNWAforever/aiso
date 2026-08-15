import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  findCreatedPolicies,
  findDisabledRlsTables,
  findDroppedPolicies,
} from '../helpers/migration-rls-scan.mjs'

/** The migration that retires the Supabase-era policies. */
const CLEANUP = '036_drop_dead_rls_policies.sql'

const MIGRATIONS = readdirSync(new URL('../../supabase/migrations', import.meta.url))
  .filter((f) => f.endsWith('.sql'))
  .sort()

const read = (name) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')

const numberOf = (name) => Number(name.slice(0, 3))

const createdBeforeCleanup = () =>
  MIGRATIONS.filter((m) => m !== CLEANUP).flatMap((m) => findCreatedPolicies(read(m)))

describe('RLS policy freeze', () => {
  /**
   * Migrations that legitimately create policies. Frozen rather than derived.
   *
   * neon-role-portability.test.mjs:8 records why a hand-maintained list of
   * migration names is normally wrong here -- one rotted, "which is how 029 went
   * unregistered". This list is different in kind: it names applied, immutable
   * history, and nothing has to be added to it when a migration is written,
   * because new files are covered by the `> 035` rule below. Its job is to prove
   * the scanner still detects anything at all, so the guard cannot quietly
   * become a no-op.
   */
  const HISTORICAL_POLICY_MIGRATIONS = [
    '003_phase3a_accounts.sql',
    '004_phase3a_clients_fk.sql',
    '008_scans_account_id.sql',
    '010_phase3b.sql',
    '012_aiso_v3.sql',
    '020_scans_public_select.sql',
    '021_local_trust_roi.sql',
  ]

  it('still detects the historical policy migrations', () => {
    const found = MIGRATIONS.filter((m) => findCreatedPolicies(read(m)).length > 0)

    expect(found).toEqual(HISTORICAL_POLICY_MIGRATIONS)
  })

  it('no migration after 035 creates a policy', () => {
    const offenders = MIGRATIONS.filter((m) => numberOf(m) > 35).flatMap((m) =>
      findCreatedPolicies(read(m)).map((policy) => `${m}: ${policy}`),
    )

    expect(offenders).toEqual([])
  })

  it(`${CLEANUP} drops every policy the earlier migrations created`, () => {
    const dropped = new Set(findDroppedPolicies(read(CLEANUP)))
    const missing = [...new Set(createdBeforeCleanup())].filter((p) => !dropped.has(p)).sort()

    expect(missing).toEqual([])
  })

  it(`${CLEANUP} drops nothing that was never created`, () => {
    const created = new Set(createdBeforeCleanup())
    const stray = findDroppedPolicies(read(CLEANUP)).filter((p) => !created.has(p)).sort()

    expect(stray).toEqual([])
  })

  it('drops exactly the 30 policies verified in production on 2026-08-16', () => {
    expect(findDroppedPolicies(read(CLEANUP))).toHaveLength(30)
  })

  it(`${CLEANUP} disables RLS on exactly the tables whose policies it drops`, () => {
    const sql = read(CLEANUP)
    const tablesWithDroppedPolicies = [
      ...new Set(findDroppedPolicies(sql).map((policy) => policy.split('.')[0])),
    ].sort()
    const disabled = [...findDisabledRlsTables(sql)].sort()

    expect(disabled).toEqual(tablesWithDroppedPolicies)
  })
})
