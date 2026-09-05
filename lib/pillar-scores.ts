import { scorePts } from '@/lib/scoring'
import type { CheckResult, CheckStatus } from '@/lib/types'

/**
 * Diagnostic pillar scores are independent views over the existing 20 checks.
 * They intentionally overlap and never replace or add to the established
 * 100-point AISO score.
 */
export const PILLAR_SCORE_VERSION = '2026-09-05.v2'

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

interface PillarMetrics {
  earned: number
  maximum: number
  coverage: number
  checks: number
  covered: number
  passing: number
  warnings: number
  failing: number
}

/** Pure normalized input: only pass checks from validated collection evidence. */
export type PillarEvidenceInputs = Readonly<Record<string, {
  applicability: string; collection: string; assessment: string
}>>
export type PillarState = 'insufficient_evidence' | 'provisional' | 'scored'
export type PillarScore = PillarMetrics & (
  | { state: 'insufficient_evidence'; score: null }
  | { state: 'provisional' | 'scored'; score: number }
  | { state?: undefined; score: number } // Historical immutable v1 snapshots.
)
export function pillarStateForCoverage(coverage: number): PillarState {
  return coverage < 0.67 ? 'insufficient_evidence' : coverage < 0.85 ? 'provisional' : 'scored'
}

export interface PillarScoreSnapshot {
  methodologyVersion: string
  seo: PillarScore
  aeo: PillarScore
  geo: PillarScore
}

const CHECK_STATUSES: readonly CheckStatus[] = ['pass', 'warn', 'fail']

function asCheckResult(value: unknown): CheckResult | null {
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

  return null
}

function calculatePillar(
  results: Record<string, unknown>,
  weights: Readonly<Record<string, number>>,
  evidence: PillarEvidenceInputs,
): PillarScore {
  let maximum = 0
  let earned = 0
  let coveredWeight = 0
  let covered = 0
  let passing = 0
  let warnings = 0
  let failing = 0

  for (const [key, weight] of Object.entries(weights)) {
    const observation = evidence[key]
    if (observation?.applicability === 'not-applicable' && observation.assessment === 'not-applicable') continue
    maximum += weight
    const result = asCheckResult(results[key])
    if (result === null || observation?.collection !== 'complete' ||
      observation.applicability !== 'applicable' || observation.assessment !== result.status) continue

    coveredWeight += weight
    covered += 1
    earned += scorePts(result, weight)

    if (result.status === 'pass') passing += 1
    else if (result.status === 'warn') warnings += 1
    else failing += 1
  }

  const coverage = maximum > 0 ? coveredWeight / maximum : 0
  const state = pillarStateForCoverage(coverage)

  return {
    ...(state === 'insufficient_evidence'
      ? { state, score: null }
      : { state, score: Math.round((earned / coveredWeight) * 100) }),
    earned: Number(earned.toFixed(1)),
    maximum,
    coverage,
    checks: Object.keys(weights).length,
    covered,
    passing,
    warnings,
    failing,
  }
}

export function calculatePillarScores(results: Record<string, unknown>, evidence: PillarEvidenceInputs = {}): PillarScoreSnapshot {
  return {
    methodologyVersion: PILLAR_SCORE_VERSION,
    seo: calculatePillar(results, PILLAR_WEIGHTS.seo, evidence),
    aeo: calculatePillar(results, PILLAR_WEIGHTS.aeo, evidence),
    geo: calculatePillar(results, PILLAR_WEIGHTS.geo, evidence),
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPillarScore(value: unknown, current: boolean): value is PillarScore {
  if (!value || typeof value !== 'object') return false
  const score = value as Record<string, unknown>

  if (current) {
    if (!isFiniteNumber(score.coverage) || score.coverage < 0 || score.coverage > 1 ||
      score.state !== pillarStateForCoverage(score.coverage)) return false
    if (score.score !== null && (!isFiniteNumber(score.score) || score.score < 0 || score.score > 100)) return false
    if (score.maximum === 0 && (score.coverage !== 0 || score.score !== null)) return false
  }
  return (
    (score.state === 'insufficient_evidence' ? score.score === null : isFiniteNumber(score.score)) &&
    (score.state === undefined || score.state === 'insufficient_evidence' || score.state === 'provisional' || score.state === 'scored') &&
    isFiniteNumber(score.earned) &&
    isFiniteNumber(score.maximum) &&
    isFiniteNumber(score.coverage) &&
    isFiniteNumber(score.checks) &&
    isFiniteNumber(score.covered) &&
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
    isPillarScore(snapshot.seo, snapshot.methodologyVersion === PILLAR_SCORE_VERSION) &&
    isPillarScore(snapshot.aeo, snapshot.methodologyVersion === PILLAR_SCORE_VERSION) &&
    isPillarScore(snapshot.geo, snapshot.methodologyVersion === PILLAR_SCORE_VERSION)
  )
}

/**
 * A scan can carry a previously stored diagnostic snapshot. Existing scans
 * without one calculate the current diagnostic view from their stored check
 * results, keeping the UI backward compatible without a database migration.
 */
export function resolvePillarScores(results: Record<string, unknown>, evidence: PillarEvidenceInputs = {}): PillarScoreSnapshot {
  return isPillarScoreSnapshot(results.pillarScores)
    ? results.pillarScores
    : calculatePillarScores(results, evidence)
}

/**
 * True when `results.pillarScores` is a valid stored snapshot — i.e. the value
 * `resolvePillarScores` will return unmodified rather than recalculate.
 */
export function isPillarScoreStored(results: Record<string, unknown>): boolean {
  return isPillarScoreSnapshot(results.pillarScores)
}
