import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CORE_PTS, EXT_PTS, GEO_PTS, assignGrade, scorePts } from '@/lib/scoring'
import { CHECK_VERSIONS } from '@/lib/scan-evidence'
import type { CheckResult, CheckStatus } from '@/lib/types'

/**
 * The scan compatibility freeze.
 *
 * Website Scan's identity is its methodology: which twenty checks exist, which
 * bucket each belongs to, what each is worth, and where the grade boundaries
 * fall. Stored scans are only interpretable against a fixed methodology, so
 * changing any value here silently reinterprets every result ever recorded.
 *
 * The registry is therefore asserted BY VALUE, not derived from the tables it
 * guards — a test that recomputed the totals from those tables would pass no
 * matter what they said, which is the opposite of a freeze. Editing the numbers
 * below is allowed; it just has to be deliberate, and paired with a methodology
 * version bump (SCANNER_VERSION in lib/types.ts plus the affected
 * CHECK_VERSIONS entry) per docs/adr/ADR-006-scoring-and-methodology.md.
 */

/** key -> [bucket, points], ordered c1..c20. */
const FROZEN = [
  ['c1_robots', 'core', 12],
  ['c2_llms_txt', 'core', 10],
  ['c3_bot_access', 'core', 10],
  ['c4_structured_data', 'core', 7],
  ['c5_extractability', 'core', 6],
  ['c6_llms_full_txt', 'extended', 3],
  ['c7_mcp_card', 'extended', 3],
  ['c8_sitemap', 'extended', 3],
  ['c9_meta_desc', 'extended', 2],
  ['c10_headings', 'extended', 3],
  ['c11_faq', 'extended', 3],
  ['c12_canonical', 'extended', 2],
  ['c13_render', 'extended', 3],
  ['c14_internal_links', 'extended', 3],
  ['c15_entity', 'extended', 3],
  ['c16_freshness', 'extended', 2],
  ['c17_citation_density', 'geo', 7],
  ['c18_factual_density', 'geo', 6],
  ['c19_topical_authority', 'geo', 7],
  ['c20_chunkability', 'geo', 5],
] as const satisfies ReadonlyArray<readonly [string, 'core' | 'extended' | 'geo', number]>

const BUCKETS = ['core', 'extended', 'geo'] as const
const TABLES: Record<(typeof BUCKETS)[number], Record<string, number>> = {
  core: CORE_PTS,
  extended: EXT_PTS,
  geo: GEO_PTS,
}
const KEYS = FROZEN.map(([key]) => key as string)
const result = (status: CheckStatus): CheckResult => ({ status, message: '' })
const total = (table: Record<string, number>) => Object.values(table).reduce((sum, n) => sum + n, 0)

describe('scan compatibility freeze: the twenty checks', () => {
  it('registers exactly twenty distinct checks', () => {
    const live = BUCKETS.flatMap(bucket => Object.keys(TABLES[bucket]))
    expect(live).toHaveLength(20)
    expect(new Set(live).size).toBe(20)
    expect(live.sort()).toEqual([...KEYS].sort())
  })

  it.each(FROZEN)('%s is a %s check worth %i points', (key, bucket, points) => {
    expect(TABLES[bucket][key]).toBe(points)
    // Exactly one bucket, or the check would be scored twice.
    for (const other of BUCKETS.filter(name => name !== bucket)) {
      expect(Object.hasOwn(TABLES[other], key)).toBe(false)
    }
  })

  it('holds the 45 / 30 / 25 split that sums to a 100-point scale', () => {
    expect(total(CORE_PTS)).toBe(45)
    expect(total(EXT_PTS)).toBe(30)
    expect(total(GEO_PTS)).toBe(25)
    expect(total(CORE_PTS) + total(EXT_PTS) + total(GEO_PTS)).toBe(100)
  })
})

describe('scan compatibility freeze: scoring semantics', () => {
  it('awards full points for pass, half for warn, none for fail', () => {
    expect(scorePts(result('pass'), 12)).toBe(12)
    expect(scorePts(result('warn'), 12)).toBe(6)
    expect(scorePts(result('fail'), 12)).toBe(0)
  })

  it('scores a warn as exactly half of every registered weight', () => {
    for (const [, , points] of FROZEN) {
      expect(scorePts(result('warn'), points)).toBe(points / 2)
    }
  })
})

describe('scan compatibility freeze: grade boundaries', () => {
  // Inclusive lower bounds; a hair below each must drop a grade.
  it.each([
    [100, 'A+'], [90, 'A+'], [89.9, 'A'],
    [80, 'A'], [79.9, 'B'],
    [70, 'B'], [69.9, 'C'],
    [60, 'C'], [59.9, 'D'],
    [50, 'D'], [49.9, 'F'],
    [0, 'F'],
  ] as const)('scores %s as grade %s', (score, grade) => {
    expect(assignGrade(score)).toBe(grade)
  })
})

describe('scan compatibility freeze: cross-artifact agreement', () => {
  it('versions every registered check in CHECK_VERSIONS and nothing else', () => {
    expect(Object.keys(CHECK_VERSIONS).sort()).toEqual([...KEYS].sort())
  })

  it('keeps migration 041 check_key constraint in step with the registry', () => {
    // 041 enumerates the check keys in a CHECK constraint. Add or rename a check
    // in TypeScript without editing that constraint and work items for the new
    // check are rejected by the database at runtime and nowhere earlier.
    const sql = readFileSync('supabase/migrations/041_evidence_work_items.sql', 'utf8')
    const clause = /check_key is null or check_key in \(([\s\S]*?)\)\)/.exec(sql)
    expect(clause, 'migration 041 no longer declares check_key in the expected shape').not.toBeNull()
    const declared = [...clause![1]!.matchAll(/'([a-z0-9_]+)'/g)].map(match => match[1]!)
    expect(declared.sort()).toEqual([...KEYS].sort())
  })
})
