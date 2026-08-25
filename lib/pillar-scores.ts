import { scorePts } from '@/lib/scoring'
import type { CheckResult, CheckStatus } from '@/lib/types'

/**
 * Diagnostic pillar scores are independent views over the existing 20 checks.
 * They intentionally overlap and never replace or add to the established
 * 100-point AISO score.
 */
export const PILLAR_SCORE_VERSION = '2026-08-26.v1'

export const PILLAR_WEIGHTS = {
  seo: {
    c1_robots:          12,
    c3_bot_access:      10,
    c4_structured_data:  7,
    c8_sitemap:          3,
    c9_meta_desc:        2,
    c10_headings:        3,
    c12_canonical:       2,
    c13_render:          3,
    c14_internal_links:  3,
    c15_entity:          3,
    c16_freshness:       2,
  },
  aeo: {
    c2_llms_txt:         10,
    c3_bot_access:       10,
    c4_structured_data:   7,
    c5_extractability:    6,
    c6_llms_full_txt:     3,
    c7_mcp_card:          3,
    c11_faq:              3,
    c13_render:           3,
    c20_chunkability:     5,
  },
  geo: {
    c15_entity:            3,
    c16_freshness:         2,
    c17_citation_density:  7,
    c18_factual_density:   6,
    c19_topical_authority: 7,
    c20_chunkability:      5,
  },
} as const

export type PillarKey = keyof typeof PILLAR_WEIGHTS

export interface PillarScore {
  score: number
  earned: number
  maximum: number
  checks: number
  passing: number
  warnings: number
  failing: number
}

export interface PillarScoreSnapshot {
  methodologyVersion: string
  seo: PillarScore
  aeo: PillarScore
  geo: PillarScore
}

const CHECK_STATUSES: readonly CheckStatus[] = ['pass', 'warn', 'fail']

function asCheckResult(value: unknown): CheckResult {
  if (
    value &&
    typeof value === 'object' &&
    'status' in value &&
    CHECK_STATUSES.includes((value as { status: CheckStatus }).status)
  ) {
    const result = value as { status: CheckStatus; message?: unknown }
    return {
      status: result.status,
      message: typeof result.message === 'string' ? result.message : '',
    }
  }

  return { status: 'fail', message: 'missing_check_result' }
}

function calculatePillar(
  results: Record<string, unknown>,
  weights: Readonly<Record<string, number>>,
): PillarScore {
  let earned = 0
  let passing = 0
  let warnings = 0
  let failing = 0

  for (const [key, weight] of Object.entries(weights)) {
    const result = asCheckResult(results[key])
    earned += scorePts(result, weight)

    if (result.status === 'pass') passing += 1
    else if (result.status === 'warn') warnings += 1
    else failing += 1
  }

  const maximum = Object.values(weights).reduce((total, weight) => total + weight, 0)

  return {
    score: maximum > 0 ? Math.round((earned / maximum) * 100) : 0,
    earned: Number(earned.toFixed(1)),
    maximum,
    checks: Object.keys(weights).length,
    passing,
    warnings,
    failing,
  }
}

export function calculatePillarScores(results: Record<string, unknown>): PillarScoreSnapshot {
  return {
    methodologyVersion: PILLAR_SCORE_VERSION,
    seo: calculatePillar(results, PILLAR_WEIGHTS.seo),
    aeo: calculatePillar(results, PILLAR_WEIGHTS.aeo),
    geo: calculatePillar(results, PILLAR_WEIGHTS.geo),
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPillarScore(value: unknown): value is PillarScore {
  if (!value || typeof value !== 'object') return false
  const score = value as Record<string, unknown>

  return (
    isFiniteNumber(score.score) &&
    isFiniteNumber(score.earned) &&
    isFiniteNumber(score.maximum) &&
    isFiniteNumber(score.checks) &&
    isFiniteNumber(score.passing) &&
    isFiniteNumber(score.warnings) &&
    isFiniteNumber(score.failing)
  )
}

export function isPillarScoreSnapshot(value: unknown): value is PillarScoreSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>

  return (
    typeof snapshot.methodologyVersion === 'string' &&
    isPillarScore(snapshot.seo) &&
    isPillarScore(snapshot.aeo) &&
    isPillarScore(snapshot.geo)
  )
}

/**
 * A scan can carry a previously stored diagnostic snapshot. Existing scans
 * without one calculate the current diagnostic view from their stored check
 * results, keeping the UI backward compatible without a database migration.
 */
export function resolvePillarScores(results: Record<string, unknown>): PillarScoreSnapshot {
  return isPillarScoreSnapshot(results.pillarScores)
    ? results.pillarScores
    : calculatePillarScores(results)
}
