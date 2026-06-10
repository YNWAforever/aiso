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

export function calculateScore(results: ScanResults): number {
  const core = (Object.keys(CORE_PTS) as Array<keyof typeof CORE_PTS>)
    .reduce((s, k) => s + scorePts(results[k], CORE_PTS[k]), 0)
  const ext  = (Object.keys(EXT_PTS)  as Array<keyof typeof EXT_PTS>)
    .reduce((s, k) => s + scorePts((results as unknown as Record<string, CheckResult>)[k] ?? { status: 'fail', message: '' }, EXT_PTS[k]), 0)
  return core + ext
}
