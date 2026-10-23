import { CHECK_SLOTS } from '@/lib/result/view-model'
import { parseReportTimestamp } from './comparison'
import type { ReportCheckStatus, ReportTrendPoint } from './types'

/**
 * Validation for the two optional snapshot fields the one-page report draws.
 * Pure and client-safe: the dashboard parser, the service's stored-row guard
 * and the public resolver all apply the same rules, so a version one of them
 * accepts is never one another rejects.
 */

export const REPORT_TREND_MAX = 8

const CHECK_KEYS = new Set(CHECK_SLOTS.map(slot => slot.key))
const STATUSES = new Set<ReportCheckStatus>(['pass', 'warn', 'fail', 'unknown', 'not-applicable'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isReportChecks(value: unknown): value is Readonly<Record<string, ReportCheckStatus>> {
  if (!isRecord(value)) return false
  const entries = Object.entries(value)
  return entries.length > 0
    && entries.every(([key, status]) => CHECK_KEYS.has(key) && STATUSES.has(status as ReportCheckStatus))
}

/**
 * Two to eight points, strictly increasing in time, each a finite 0–100 score,
 * the first marked comparable, and ending on the report's own scan.
 */
export function isReportTrend(value: unknown, current: { scanDate: string; score: number }): value is ReadonlyArray<ReportTrendPoint> {
  if (!Array.isArray(value) || value.length < 2 || value.length > REPORT_TREND_MAX) return false
  let previous = -Infinity
  for (const point of value) {
    if (!isRecord(point)
      || typeof point.date !== 'string'
      || typeof point.score !== 'number'
      || !Number.isFinite(point.score)
      || point.score < 0
      || point.score > 100
      || typeof point.comparable !== 'boolean') return false
    const time = parseReportTimestamp(point.date)
    if (time === null || time <= previous) return false
    previous = time
  }
  const first = value[0] as ReportTrendPoint
  const last = value[value.length - 1] as ReportTrendPoint
  return first.comparable && last.date === current.scanDate && last.score === current.score
}

/**
 * Absent fields are fine (older versions); present ones must be valid. One
 * invalid field rejects the whole snapshot, as every other field does.
 */
export function hasValidReportVisuals(snapshot: Record<string, unknown>): boolean {
  const evidence = isRecord(snapshot.evidence) ? snapshot.evidence : {}
  const score = isRecord(snapshot.score) ? snapshot.score : {}
  if (snapshot.checks !== undefined && !isReportChecks(snapshot.checks)) return false
  if (snapshot.trend !== undefined && !isReportTrend(snapshot.trend, {
    scanDate: String(evidence.scanDate),
    score: Number(score.current),
  })) return false
  return true
}
