import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { findCreatedPolicies, findDroppedPolicies } from '../helpers/migration-rls-scan.mjs'

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
})
