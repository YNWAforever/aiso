import { CHECK_SLOTS, type Bucket } from '@/lib/result/view-model'
import type { ClientReportSnapshotV1, ReportPriorityFix, ReportTrendPoint } from '@/lib/reports/types'

/**
 * What the one-page report draws, from a frozen snapshot. Pure and client-safe:
 * the public page, the dashboard preview and the sample all read it.
 */

export const REPORT_TOP_FIXES = 3

const CHECK_KEYS = new Set(CHECK_SLOTS.map(slot => slot.key))

/**
 * Fixes the snapshot builder derived from the scan carry English template
 * titles around a raw check key ("Resolve failure: c1_robots"). They are
 * recognised by shape and re-worded at render in the reader's language, which
 * also repairs versions published before this existed. Anything else (an
 * agency's own recommendation) is shown exactly as written.
 */
const DERIVED: ReadonlyArray<[RegExp, ReportCheckFix['reason']]> = [
  [/^Resolve failure: /, 'fail'],
  [/^Review warning: /, 'warn'],
  [/^Address regression: /, 'regressed'],
]

export type ReportCheckFix = {
  kind: 'check'
  key: string
  checkKey: string
  reason: 'fail' | 'warn' | 'regressed'
  impact: ReportPriorityFix['expectedImpact']
}
export type ReportCustomFix = {
  kind: 'custom'
  key: string
  title: string
  rationale: string
  nextStep: string
  impact: ReportPriorityFix['expectedImpact']
}
export type ReportFixView = ReportCheckFix | ReportCustomFix

export function reportFixView(fix: ReportPriorityFix): ReportFixView {
  const reason = CHECK_KEYS.has(fix.key) ? DERIVED.find(([pattern]) => pattern.test(fix.title))?.[1] : undefined
  return reason
    ? { kind: 'check', key: fix.key, checkKey: fix.key, reason, impact: fix.expectedImpact }
    : { kind: 'custom', key: fix.key, title: fix.title, rationale: fix.rationale, nextStep: fix.nextStep, impact: fix.expectedImpact }
}

export type ReportHeatmapTile = { key: string; bucket: Bucket; status: 'pass' | 'warn' | 'fail' | 'unknown' }

export type ReportPageView = {
  score: { current: number; grade: string; previous: number | null }
  comparisonState: ClientReportSnapshotV1['score']['comparisonState']
  /** Null when this version did not record verdicts (published before the one-page report). */
  heatmap: ReportHeatmapTile[] | null
  fixes: ReportFixView[]
  /** Null when this version recorded no trend, or had nothing earlier to plot. */
  trend: ReadonlyArray<ReportTrendPoint> | null
  /** Some point was collected differently from the one before it. */
  methodChanged: boolean
  changeCounts: { improved: number; regressed: number }
}

export function buildReportPage(snapshot: ClientReportSnapshotV1): ReportPageView {
  const checks = snapshot.checks
  const trend = snapshot.trend && snapshot.trend.length >= 2 ? snapshot.trend : null
  return {
    score: {
      current: snapshot.score.current,
      grade: snapshot.score.grade,
      previous: snapshot.score.comparisonState === 'comparable' ? snapshot.score.previous ?? null : null,
    },
    comparisonState: snapshot.score.comparisonState,
    heatmap: checks
      ? CHECK_SLOTS.map(slot => {
          const status = checks[slot.key]
          return { key: slot.key, bucket: slot.bucket, status: status === 'pass' || status === 'warn' || status === 'fail' ? status : 'unknown' }
        })
      : null,
    fixes: snapshot.priorityFixes.slice(0, REPORT_TOP_FIXES).map(reportFixView),
    trend,
    methodChanged: Boolean(trend?.some(point => !point.comparable)),
    changeCounts: {
      improved: snapshot.changes.filter(change => change.kind === 'improved' || change.kind === 'added_coverage').length,
      regressed: snapshot.changes.filter(change => change.kind === 'regressed' || change.kind === 'lost_coverage').length,
    },
  }
}
