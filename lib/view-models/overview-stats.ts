import { compareScanEvidence } from '@/lib/scan-evidence'
import { projectScanStatus } from '@/lib/view-models/scan-status'
import { buildOwnerPriorities, ownerPointsAtStake } from '@/lib/view-models/owner-priorities'

/** One stored scan as the history read returns it, newest first. */
export type TrendScan = { id: string; created_at: string; score: unknown; grade: unknown; evidence: unknown }

export type OverviewStat = {
  /** Latest known value; null when the latest scan has none to give. */
  latest: number | null
  /** Oldest first, only scans that had a value. */
  points: number[]
  /**
   * Latest minus the scan before it. Null unless both scans were collected the
   * same way (compareScanEvidence), so a methodology change never reads as
   * progress or regression.
   */
  delta: number | null
}

export type OverviewStats = {
  score: OverviewStat
  /** Observed failing or warning checks. Down is good. */
  fixesLeft: OverviewStat
  /** Points those findings forfeit. Down is good. */
  pointsToGain: OverviewStat
  /** Score per scan for the trend chart, oldest first. */
  trend: { id: string; date: string; score: number }[]
}

const round = (value: number) => Math.round(value * 100) / 100

function stat(values: (number | null)[], comparable: boolean): OverviewStat {
  const points = values.slice().reverse().filter((value): value is number => value !== null)
  const [latest = null, previous = null] = values
  return {
    latest,
    points,
    delta: comparable && latest !== null && previous !== null ? round(latest - previous) : null,
  }
}

/** Pure: newest-first scan rows in, three stat series and a trend out. */
export function buildOverviewStats(scans: TrendScan[]): OverviewStats {
  const scores = scans.map(scan => projectScanStatus({
    score: typeof scan.score === 'number' ? scan.score : scan.score == null ? null : Number(scan.score),
    grade: typeof scan.grade === 'string' ? scan.grade : null,
    evidence: scan.evidence,
  }).score)
  const fixes = scans.map(scan => {
    const priorities = buildOwnerPriorities(scan.evidence)
    return priorities.state === 'ready' ? priorities.observedFindings : priorities.state === 'all-clear' ? 0 : null
  })
  const points = scans.map(scan => ownerPointsAtStake(scan.evidence))
  const comparable = scans.length > 1 && compareScanEvidence(scans[1]!.evidence, scans[0]!.evidence).comparable
  return {
    score: stat(scores, comparable),
    fixesLeft: stat(fixes, comparable),
    pointsToGain: stat(points, comparable),
    trend: scans.map((scan, index) => ({ id: scan.id, date: scan.created_at, score: scores[index] }))
      .filter((point): point is { id: string; date: string; score: number } => point.score !== null)
      .reverse(),
  }
}
