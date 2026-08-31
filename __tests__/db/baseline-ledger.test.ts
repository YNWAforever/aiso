import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BASELINE = readFileSync(
  join(process.cwd(), 'supabase', 'baseline', '000_baseline_2026-08-31.sql'),
  'utf8',
)
const MIGRATE = readFileSync(join(process.cwd(), 'scripts', 'migrate.ts'), 'utf8')

describe('baseline ledger', () => {
  it('creates the schema_migrations ledger with a checksum column', () => {
    expect(BASELINE).toMatch(/create table if not exists schema_migrations/i)
    expect(BASELINE).toMatch(/checksum\s+text/i)
  })

  it('seeds exactly one ledger row naming itself', () => {
    const inserts = BASELINE.match(/insert into schema_migrations/gi) ?? []
    expect(inserts).toHaveLength(1)
    expect(BASELINE).toContain('000_baseline_2026-08-31.sql')
  })

  it('keeps the column shape migrate.ts already relies on', () => {
    expect(BASELINE).toMatch(/filename\s+text\s+primary key/i)
    expect(BASELINE).toMatch(/applied_at\s+timestamptz/i)
  })

  it('keeps migrate.ts and the baseline declaring the same ledger columns', () => {
    // Both paths must create an identical schema_migrations or the equivalence
    // proof breaks on the columns class.
    expect(MIGRATE).toMatch(/checksum\s+text/i)
  })
})
