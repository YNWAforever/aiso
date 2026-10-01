import type { SourceClass } from '@/lib/integrations/analytics/sources'

/** Length of each comparison window, in days (spec 3.1). */
export const WINDOW_DAYS = 28

/** Google's reporting lag, added after the after-window to get "ready on". */
export const LAG_DAYS = 3

/**
 * Most registered pages one delivery can measure. Migration 056's shape trigger
 * enforces the same number in SQL (`pages between 1 and 20`);
 * __tests__/lib/attribution-windows.test.ts reads that file and fails if the
 * two drift.
 */
export const MEASURE_PAGES_MAX = 20

export type TargetStatus =
  | 'withdrawn'
  | 'not_supported'
  | 'not_measured'
  | 'unavailable'
  | 'not_ready'
  | 'insufficient_history'
  | 'comparable'

export type Figure = {
  before: number | null
  after: number | null
  /** after - before; null when either side is null. */
  change: number | null
  /** change / before; 'new' when before is 0 and after is not; null for ctr and position. */
  changePct: number | 'new' | null
}

/**
 * What a data source (Search Console or GA4) tells us about itself.
 * `boundAt` is an ISO timestamp or a Hong Kong YYYY-MM-DD date.
 * `okRunDates` are the Hong Kong dates of `ok` runs since `boundAt`.
 * `latestOutcome` is the newest run's outcome; the store supplies the latest
 * NON-`deferred` outcome since the bind, and null when there is none. Both null
 * and `deferred` are "no information": a deferred run only ran out of time, and
 * null means no run has finished yet (say every run since an event re-pick
 * deferred). `compareTarget` never treats either as failing.
 */
export type SourceState = {
  boundAt: string | null
  coveredFrom: string | null
  okRunDates: string[]
  latestOutcome: string | null
}

export type SearchDay = { date: string; clicks: number; impressions: number; position: number }
export type EnquiryDay = { date: string; sourceClass: SourceClass; count: number }

export type EnquiryResult = {
  status: TargetStatus
  reason?: string
  readyOn?: string
  missingFrom?: string
  missingTo?: string
  total?: Figure
  organic_search?: Figure
  ai_assistant?: Figure
  other?: Figure
}

export type TargetResult = {
  status: TargetStatus
  reason?: string
  readyOn?: string
  missingFrom?: string
  missingTo?: string
  search?: { clicks: Figure; impressions: Figure; ctr: Figure; position: Figure }
  enquiries?: EnquiryResult
}

/**
 * What the delivery form may offer to measure: the brand's registered pages.
 * Null (where this is passed) means attribution is off, not entitled, or the
 * lookup failed — the form then omits the whole field.
 */
export type MeasureOptions = { pages: Array<{ id: string; url: string; label: string }> }
