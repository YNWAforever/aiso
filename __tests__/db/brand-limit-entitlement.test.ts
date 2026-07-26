import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { PLAN_IDS, PLAN_CATALOG } from '@/lib/plans/catalog'

// 028 supersedes 026's definition of check_brand_limit(); assertions target the
// current definition.
const migrationPath = 'supabase/migrations/028_account_plan_overrides.sql'

function migrationSql() {
  return existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
}

describe('effective brand-limit migration', () => {
  it('serializes inserts for the same account before counting brands', () => {
    expect(migrationSql()).toMatch(/pg_advisory_xact_lock/i)
  })

  it('derives entitlement from status, subscription, and trial expiry', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/when\s+account_status\s+in\s*\(\s*'past_due'\s*,\s*'cancelled'\s*\)\s+then\s+'free'/i)
    expect(sql).toMatch(/when\s+account_status\s*=\s*'active'\s+and\s+has_subscription\s+then\s+stored_plan/i)
  })

  it('fails closed for missing or malformed account state', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/if\s+not\s+found\s+then[\s\S]*raise\s+exception\s+'ACCOUNT_ENTITLEMENT_INVALID'/i)
    expect(sql).toMatch(/stored_plan\s+not\s+in\s*\(\s*'basic'\s*,\s*'pro'\s*,\s*'enterprise'\s*\)/i)
  })

  it('evaluates a live override before the stored-plan validation', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/override_is_live/i)
    // The override branch must be assigned before the malformed-state guard runs,
    // otherwise a comp cannot rescue an account with broken Stripe state.
    const overrideAt = sql.search(/override_is_live\s*:=/i)
    const validationAt = sql.search(/account plan or status is malformed/i)
    expect(overrideAt).toBeGreaterThan(-1)
    expect(validationAt).toBeGreaterThan(-1)
    expect(overrideAt).toBeLessThan(validationAt)
  })

  it('honours a null override expiry as permanent', () => {
    expect(migrationSql()).toMatch(/override_expires_at\s+is\s+null\s+or\s+override_expires_at\s*>\s*pg_catalog\.now\(\)/i)
  })

  // The real drift guard: derived from PLAN_CATALOG, not hardcoded.
  it('keeps SQL brand limits in sync with PLAN_CATALOG', () => {
    const sql = migrationSql()
    for (const id of PLAN_IDS) {
      const expected = PLAN_CATALOG[id].maxBrands
      const match = sql.match(new RegExp(`when\\s+'${id}'\\s+then\\s+(\\d+)`, 'i'))
      expect(match, `migration must define a brand limit for '${id}'`).not.toBeNull()
      expect(
        Number(match![1]),
        `PLAN_CATALOG.${id}.maxBrands is ${expected} but ${migrationPath} says ${match![1]}`,
      ).toBe(expected)
    }
  })

  it('documents migration 028 as a release prerequisite', () => {
    expect(readFileSync('README.md', 'utf8')).toContain(migrationPath)
  })
})
