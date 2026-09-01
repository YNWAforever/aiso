import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAW = readFileSync(join(process.cwd(), 'supabase', 'seeds', '001_synthetic.sql'), 'utf8')

/**
 * The seed's own comments explain the traps by naming them -- "ON CONFLICT",
 * "trial_ends_at" -- so a regex over the raw text matches the documentation as
 * well as the SQL. Strip comments first, exactly as scripts/migrate.ts's
 * stripNonStatements does, so the prose that prevents the bug cannot trip the
 * test that detects it.
 */
function statementsOnly(sql: string): string {
  return sql.replace(/--.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

const SEED = statementsOnly(RAW)

/** Brand limits, mirroring check_brand_limit() in the baseline. */
const BRAND_LIMIT: Record<string, number> = { free: 1, basic: 1, pro: 3, enterprise: 10 }

function seededAccountPlan(sql: string): string | null {
  return /insert into accounts[\s\S]*?values\s*\([^)]*?'(basic|pro|enterprise)'/i.exec(sql)?.[1] ?? null
}

function seededClientCount(sql: string): number {
  const stmt = /insert into clients[\s\S]*?;/i.exec(sql)?.[0] ?? ''
  return [...stmt.matchAll(/\(\s*'[0-9a-f-]{36}'/gi)].length
}

describe('synthetic seed', () => {
  it('seeds no identity: no neon_auth or profiles writes', () => {
    expect(SEED).not.toMatch(/insert\s+into\s+(public\.)?profiles/i)
    expect(SEED).not.toMatch(/insert\s+into\s+neon_auth/i)
  })

  it('is written to be re-runnable', () => {
    const inserts = SEED.match(/insert into/gi) ?? []
    const arbiters = SEED.match(/on conflict/gi) ?? []
    expect(inserts.length).toBeGreaterThan(0)
    expect(arbiters).toHaveLength(inserts.length)
  })

  // effective_plan only reaches the stored plan when status is 'active' AND a
  // subscription id is present (check_brand_limit, baseline :2077 and :2082).
  // Without both, a 'pro' account still resolves to 'free' and a limit of 1.
  it('seeds an account that actually resolves to its stored plan', () => {
    expect(SEED).toMatch(/'active'/)
    expect(SEED).toMatch(/stripe_subscription_id/i)
    expect(SEED).not.toMatch(/trial_ends_at/i)
  })

  // THE INVARIANT. Postgres fires BEFORE INSERT row triggers before the
  // ON CONFLICT arbiter, so on a re-run enforce_brand_limit counts the rows
  // already present and raises BRAND_LIMIT_REACHED before `do nothing` can skip
  // them. Re-runs are safe only while the seeded count stays STRICTLY BELOW the
  // limit. Adding one more client under this account breaks that silently.
  it('seeds strictly fewer clients than the account brand limit', () => {
    const plan = seededAccountPlan(SEED)
    expect(plan).not.toBeNull()
    const limit = BRAND_LIMIT[plan as string]
    expect(limit).toBeGreaterThan(0)
    expect(seededClientCount(SEED)).toBeLessThan(limit)
  })
})
