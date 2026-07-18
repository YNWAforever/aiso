import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/026_effective_brand_limit.sql'

function migrationSql() {
  return existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
}

describe('effective brand-limit migration', () => {
  it('serializes inserts for the same account before counting brands', () => {
    const sql = migrationSql()
    const lockPosition = sql.search(/pg_advisory_xact_lock\s*\([^;]*new\.account_id/is)
    const countPosition = sql.search(/select\s+count\s*\(\s*\*\s*\)[\s\S]*from\s+public\.clients/is)

    expect(lockPosition).toBeGreaterThanOrEqual(0)
    expect(countPosition).toBeGreaterThan(lockPosition)
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.check_brand_limit\s*\(/i)
    expect(sql).toMatch(/create\s+trigger\s+enforce_brand_limit[\s\S]*execute\s+function\s+public\.check_brand_limit\s*\(\s*\)/i)
  })

  it('derives entitlement from status, subscription, and trial expiry', () => {
    const sql = migrationSql()

    expect(sql).toMatch(/select[\s\S]*plan[\s\S]*status[\s\S]*stripe_subscription_id[\s\S]*trial_ends_at[\s\S]*from\s+public\.accounts/i)
    expect(sql).toMatch(/when\s+account_status\s+in\s*\(\s*'past_due'\s*,\s*'cancelled'\s*\)\s+then\s+'free'/i)
    expect(sql).toMatch(/when\s+account_status\s*=\s*'active'[\s\S]*has_subscription\s+then\s+stored_plan/i)
    expect(sql).toMatch(/when\s+trial_is_live\s+or\s*\(\s*account_status\s*=\s*'trialing'\s+and\s+has_subscription\s*\)[\s\S]*then\s+stored_plan/i)
  })

  it('enforces free and Basic at one, Pro at three, and Enterprise at ten', () => {
    const sql = migrationSql()

    expect(sql).toMatch(/when\s+'pro'\s+then\s+3/i)
    expect(sql).toMatch(/when\s+'enterprise'\s+then\s+10/i)
    expect(sql).toMatch(/when\s+'free'\s+then\s+1/i)
    expect(sql).toMatch(/when\s+'basic'\s+then\s+1/i)
  })

  it('fails closed for missing or malformed account state', () => {
    const sql = migrationSql()

    expect(sql).toMatch(/if\s+not\s+found\s+then[\s\S]*raise\s+exception\s+'ACCOUNT_ENTITLEMENT_INVALID'/i)
    expect(sql).toMatch(/stored_plan\s+not\s+in\s*\(\s*'basic'\s*,\s*'pro'\s*,\s*'enterprise'\s*\)/i)
    expect(sql).toMatch(/account_status\s+not\s+in\s*\(\s*'active'\s*,\s*'past_due'\s*,\s*'cancelled'\s*,\s*'trialing'\s*\)/i)
    expect(sql).toMatch(/stripe_subscription_id[\s\S]*btrim[\s\S]*ACCOUNT_ENTITLEMENT_INVALID/i)
  })

  it('documents migration 026 as a release prerequisite', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain(migrationPath)
    expect(readme).toMatch(/before releasing self-service brand creation/i)
  })
})
