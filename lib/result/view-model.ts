import { CORE_PTS, EXT_PTS, GEO_PTS, capScore } from '@/lib/scoring'
import { EFFORT_MAP, type Effort } from '@/lib/impact'
import type { CheckAssessment } from '@/lib/view-models/check-priority'

/**
 * The result page's numbers, derived only from evidence-backed verdicts (the
 * same ones the public summary carries). Pure and client-safe: the page, its
 * tests and the scan progress all read the same answers from here.
 */

export type Bucket = 'core' | 'extended' | 'geo'

const BUCKET_WEIGHTS: Record<Bucket, Readonly<Record<string, number>>> = { core: CORE_PTS, extended: EXT_PTS, geo: GEO_PTS }

export interface CheckSlot { key: string; bucket: Bucket; weight: number }

/** All 20 checks in scoring order, with the bucket and points each one carries. */
export const CHECK_SLOTS: readonly CheckSlot[] = (Object.keys(BUCKET_WEIGHTS) as Bucket[]).flatMap(bucket =>
  Object.entries(BUCKET_WEIGHTS[bucket]).map(([key, weight]) => ({ key, bucket, weight })),
)

export interface FixItem {
  key: string
  bucket: Bucket
  assessment: 'warn' | 'fail'
  /** Points the score would gain once this check passes. */
  points: number
  effort: Effort
}

const EFFORT_RANK: Record<Effort, number> = { minutes: 0, hours: 1, days: 2 }

/** Points a passing check would add: the full weight for a fail, half for a warning (lib/scoring.ts scorePts). */
export function pointsToGain(weight: number, assessment: 'warn' | 'fail'): number {
  return assessment === 'fail' ? weight : weight / 2
}

/**
 * Every failing or warning check, worth the most points first. Ties go to the
 * quicker fix, then the check order. Unverified checks are never listed: a fix
 * needs a confirmed problem.
 */
export function rankFixes(assessments: Readonly<Record<string, CheckAssessment>>): FixItem[] {
  return CHECK_SLOTS.flatMap((slot, index) => {
    const assessment = assessments[slot.key]
    if (assessment !== 'warn' && assessment !== 'fail') return []
    return [{ item: { key: slot.key, bucket: slot.bucket, assessment, points: pointsToGain(slot.weight, assessment), effort: EFFORT_MAP[slot.key] ?? 'hours' }, index }]
  })
    .sort((a, b) => b.item.points - a.item.points || EFFORT_RANK[a.item.effort] - EFFORT_RANK[b.item.effort] || a.index - b.index)
    .map(entry => entry.item)
}

/** The score once the given fixes are done, capped at 100 and kept to two decimals like the stored score. */
export function potentialScore(score: number, fixes: readonly FixItem[]): number {
  return capScore(Math.round((score + fixes.reduce((sum, fix) => sum + fix.points, 0)) * 100) / 100)
}

export interface BucketPoints { earned: number; max: number }

/** Points earned per bucket from confirmed verdicts. Unverified checks earn nothing until they are confirmed. */
export function bucketPoints(assessments: Readonly<Record<string, CheckAssessment>>): Record<Bucket, BucketPoints> {
  const result: Record<Bucket, BucketPoints> = { core: { earned: 0, max: 0 }, extended: { earned: 0, max: 0 }, geo: { earned: 0, max: 0 } }
  for (const slot of CHECK_SLOTS) {
    const assessment = assessments[slot.key]
    result[slot.bucket].max += slot.weight
    result[slot.bucket].earned += assessment === 'pass' ? slot.weight : assessment === 'warn' ? slot.weight / 2 : 0
  }
  return result
}

/** Verdict as the visuals' status vocabulary: not-applicable and unverified both read as "not checked". */
export function visualStatus(assessment: CheckAssessment | undefined): 'pass' | 'warn' | 'fail' | 'unknown' {
  return assessment === 'pass' || assessment === 'warn' || assessment === 'fail' ? assessment : 'unknown'
}

export type CheckFilter = 'all' | 'fail' | 'warn' | 'pass' | 'unknown'

export function matchesFilter(assessment: CheckAssessment | undefined, filter: CheckFilter): boolean {
  return filter === 'all' || visualStatus(assessment) === filter
}
