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
  /** Null when it repeats the rationale (stored recommendations fill both with one text). */
  nextStep: string | null
  impact: ReportPriorityFix['expectedImpact']
}
export type ReportFixView = ReportCheckFix | ReportCustomFix

export function reportFixView(fix: ReportPriorityFix): ReportFixView {
  const reason = CHECK_KEYS.has(fix.key) ? DERIVED.find(([pattern]) => pattern.test(fix.title))?.[1] : undefined
  return reason
    ? { kind: 'check', key: fix.key, checkKey: fix.key, reason, impact: fix.expectedImpact }
    : {
        kind: 'custom', key: fix.key, title: fix.title, rationale: fix.rationale,
        nextStep: fix.nextStep.trim() === fix.rationale.trim() ? null : fix.nextStep, impact: fix.expectedImpact,
      }
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

/**
 * Print layout for one A4 page. The visuals are a fixed size; what varies is
 * the text an agency or a generator wrote (a summary of up to 1,200
 * characters, recommendations of up to 1,200 each). Han characters set about
 * 2.2 times as wide as Latin ones in this layout, so they weigh more.
 *
 * Steps sit at least 0.06 below the largest scale that still fits, measured
 * by tests/e2e/report-print.spec.ts on Chromium: CI runners set text a little
 * larger than a laptop, and a zero-margin step failed there. Below the last
 * step text stops being readable, so instead of shrinking further an
 * agency's recommendations are cut to a few lines in print only, with a note
 * that the online report has the full text.
 */
export const PRINT_ZOOM_STEPS: ReadonlyArray<{ upTo: number; zoom: number }> = [
  { upTo: 600, zoom: 0.86 },
  { upTo: 1500, zoom: 0.84 },
  { upTo: 3000, zoom: 0.76 },
]
/** Past the last step: the readable floor, with an agency's text cut in print. */
export const PRINT_FLOOR_ZOOM = 0.68

const WIDE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/

export function reportPrintLayout(snapshot: ClientReportSnapshotV1): { zoom: number; shortenFixes: boolean } {
  const custom = buildReportPage(snapshot).fixes.flatMap(fix => fix.kind === 'custom' ? [fix.title, fix.rationale, fix.nextStep ?? ''] : [])
  let weight = 0
  for (const char of [snapshot.executiveSummary, ...custom].join('')) weight += WIDE.test(char) ? 2.2 : 1
  const step = PRINT_ZOOM_STEPS.find(candidate => weight <= candidate.upTo)
  return step ? { zoom: step.zoom, shortenFixes: false } : { zoom: PRINT_FLOOR_ZOOM, shortenFixes: true }
}
