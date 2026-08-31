import type { CheckResult, ScanResults } from '@/lib/types'

// ── Scoring: Core 45 + Extended 30 + GEO 25 = 100 ────────────────
export const CORE_PTS = {
  c1_robots:          12,
  c2_llms_txt:        10,
  c3_bot_access:      10,
  c4_structured_data:  7,
  c5_extractability:   6,
} as const // total 45

export const EXT_PTS = {
  c6_llms_full_txt:    3,
  c7_mcp_card:         3,
  c8_sitemap:          3,
  c9_meta_desc:        2,
  c10_headings:        3,
  c11_faq:             3,
  c12_canonical:       2,
  c13_render:          3,
  c14_internal_links:  3,
  c15_entity:          3,
  c16_freshness:       2,
} as const // total 30

export const GEO_PTS = {
  c17_citation_density:  7,
  c18_factual_density:   6,
  c19_topical_authority: 7,
  c20_chunkability:      5,
} as const // total 25

export function scorePts(result: CheckResult, weight: number): number {
  return result.status === 'pass' ? weight : result.status === 'warn' ? weight * 0.5 : 0
}

export function assignGrade(score: number): string {
  if (score >= 90) return 'A+'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 60) return 'C'
  if (score >= 50) return 'D'
  return 'F'
}

export function capScore(value: number): number {
  return Math.min(100, value)
}

// Missing keys score as a fail (0 points) rather than throwing — callers may
// legitimately pass a partial results object (e.g. tests isolating one check
// category, or a category whose checks haven't run yet). `object` + internal
// cast (rather than a `Record` param type) so it accepts ScanResults and any
// other check-keyed shape without requiring an index signature on each.
function sumWeightedScore(results: object, pts: Record<string, number>): number {
  const r = results as Record<string, CheckResult | undefined>
  return (Object.keys(pts) as Array<keyof typeof pts>)
    .reduce((s, k) => s + scorePts(r[k as string] ?? { status: 'fail', message: '' }, pts[k]), 0)
}

export function calculateScore(results: ScanResults): number {
  return sumWeightedScore(results, CORE_PTS) + sumWeightedScore(results, EXT_PTS)
}

export function calculateGeoScore(results: Partial<Record<keyof typeof GEO_PTS, CheckResult>>): number {
  return sumWeightedScore(results, GEO_PTS)
}
