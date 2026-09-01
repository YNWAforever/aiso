import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BASELINE = readFileSync(
  join(process.cwd(), 'supabase', 'baseline', '000_baseline_2026-08-31.sql'),
  'utf8',
)
const MIGRATE = readFileSync(join(process.cwd(), 'scripts', 'migrate.ts'), 'utf8')

const MIGRATIONS = readdirSync(join(process.cwd(), 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()

/**
 * The chain insert, matched by its column list.
 *
 * The lineage row names `(filename, checksum)`; the chain rows name `(filename)`
 * alone, so the closing paren straight after `filename` distinguishes them
 * without depending on which appears first in the file.
 */
function chainInsertStatement(sql: string): string | null {
  const match = /insert into schema_migrations \(filename\)\s*values[\s\S]*?;/i.exec(sql)
  return match ? match[0] : null
}

function listedChainMigrations(sql: string): string[] {
  const statement = chainInsertStatement(sql)
  if (!statement) return []
  return [...statement.matchAll(/'([^']+\.sql)'/g)].map((m) => m[1])
}

describe('baseline ledger', () => {
  it('creates the schema_migrations ledger with a checksum column', () => {
    expect(BASELINE).toMatch(/create table if not exists schema_migrations/i)
    expect(BASELINE).toMatch(/checksum\s+text/i)
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

  it('records its own lineage row with a checksum', () => {
    expect(BASELINE).toMatch(/insert into schema_migrations \(filename, checksum\)/i)
    expect(BASELINE).toContain("'000_baseline_2026-08-31.sql'")
  })

  // Without these rows planMigrations() reports every chain file as pending on a
  // baselined database and 001 aborts on an already-existing table, so a
  // greenfield project cannot be brought to head at all.
  it('records the chain it subsumes', () => {
    expect(listedChainMigrations(BASELINE).length).toBeGreaterThan(0)
  })

  // A PREFIX, not every file. Migration 039 and later must apply to both
  // lineages; listing one here would record it as applied without ever creating
  // its objects -- the stranded-objects hazard unappliedBaselineClaims exists to
  // prevent. Prefix of the SORTED FILENAMES, not of the numbering: 005 and 006
  // have never existed, so a numeric-contiguity check would fail on a legitimate
  // pre-existing gap.
  it('records a contiguous prefix of supabase/migrations/', () => {
    const listed = listedChainMigrations(BASELINE)
    expect(listed).toEqual(MIGRATIONS.slice(0, listed.length))
  })

  // `checksum` means "these bytes produced this lineage", and only the baseline
  // file's bytes were hashed. Omitting it also makes these rows byte-identical
  // in shape to what migrate.ts writes on the legacy path, which names only
  // `filename`.
  it('records chain rows without a checksum', () => {
    expect(chainInsertStatement(BASELINE)).not.toMatch(/checksum/i)
  })
})
