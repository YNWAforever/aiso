import type { SourceClass } from '@/lib/integrations/analytics/sources'

import type {
  EnquiryDay,
  EnquiryResult,
  Figure,
  SearchDay,
  SourceState,
  TargetResult,
  TargetStatus,
} from './types'
import { WINDOW_DAYS } from './types'
import { addDays, deliveryDay, readyOn, windowsFor, type DayRange } from './windows'

// The comparison itself (spec 3.2 - 3.3). Pure: no I/O, no clock. `today` is an
// input, and so are the source states, which the caller reads from the ledgers.
//
// Plan rulings this relies on:
//  1. Stored history is gap-free from `coveredFrom`, so a day with no row inside
//     the covered range is a real zero and is summed as one.
//  2. A source is ready when it has an `ok` run (since its bind) whose Hong Kong
//     date is on or after D+31 - not when its `data_through` says so.

// Every `reason` literal here must be in UNAVAILABLE_REASONS (dto.ts) and have
// copy in REASON_COPY; __tests__/components/attribution-render.test.tsx reads
// this file and fails if one does not.
type Verdict = {
  status: Exclude<TargetStatus, 'withdrawn' | 'not_supported' | 'not_measured'>
  reason?: string
  readyOn?: string
  missingFrom?: string
  missingTo?: string
}

const CLASSES: readonly SourceClass[] = ['organic_search', 'ai_assistant', 'other']

function inRange(date: string, r: DayRange): boolean {
  return date >= r.from && date <= r.to
}

/** boundAt is an ISO timestamp or an already-Hong-Kong date; both become a date. */
function boundDay(boundAt: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(boundAt) ? boundAt : deliveryDay(boundAt)
}

/** The shared reading of one source's state against one delivery day. */
function verdictFor(state: SourceState | null, day: string, today: string): Verdict {
  if (!state || !state.boundAt) return { status: 'unavailable', reason: 'not_bound' }

  const beforeStart = addDays(day, -WINDOW_DAYS)
  if (boundDay(state.boundAt) > beforeStart) return { status: 'unavailable', reason: 'rebound' }

  const ready = readyOn(day)
  const hasReadyRun = state.okRunDates.some((d) => d >= ready)

  // A `deferred` run only ran out of time: it carries no information about the
  // source's health (the owner-state modules ignore it too), so it never reads
  // as failing and evaluation falls through to not_ready / history / comparable.
  // A null outcome is the same: no run has FINISHED since the bind (the store
  // passes the latest non-deferred outcome, so a binding whose every run since
  // bound_at or an event re-pick deferred arrives as null). Nothing has failed.
  const failing = state.latestOutcome !== null && state.latestOutcome !== 'ok' && state.latestOutcome !== 'deferred'
  if (failing && !hasReadyRun) {
    return { status: 'unavailable', reason: 'sync_failing' }
  }
  if (today < ready || !hasReadyRun) return { status: 'not_ready', readyOn: ready }

  if (state.coveredFrom === null || state.coveredFrom > beforeStart) {
    const dayBefore = addDays(day, -1)
    const lastUncovered =
      state.coveredFrom === null ? dayBefore : addDays(state.coveredFrom, -1)
    return {
      status: 'insufficient_history',
      missingFrom: beforeStart,
      missingTo: lastUncovered < dayBefore ? lastUncovered : dayBefore,
    }
  }
  return { status: 'comparable' }
}

function figure(before: number | null, after: number | null, relative: boolean): Figure {
  const change = before === null || after === null ? null : after - before
  let changePct: Figure['changePct'] = null
  if (relative && change !== null && before !== null) {
    changePct = before === 0 ? (after === 0 ? 0 : 'new') : change / before
  }
  return { before, after, change, changePct }
}

type SearchTotals = { clicks: number; impressions: number; weightedPosition: number }

function searchTotals(days: SearchDay[], range: DayRange): SearchTotals {
  const t: SearchTotals = { clicks: 0, impressions: 0, weightedPosition: 0 }
  for (const d of days) {
    if (!inRange(d.date, range)) continue
    t.clicks += d.clicks
    t.impressions += d.impressions
    t.weightedPosition += d.position * d.impressions
  }
  return t
}

const ctrOf = (t: SearchTotals) => (t.impressions > 0 ? t.clicks / t.impressions : null)
const positionOf = (t: SearchTotals) =>
  t.impressions > 0 ? t.weightedPosition / t.impressions : null

function searchFigures(days: SearchDay[], day: string): NonNullable<TargetResult['search']> {
  const w = windowsFor(day)
  const b = searchTotals(days, w.before)
  const a = searchTotals(days, w.after)
  return {
    clicks: figure(b.clicks, a.clicks, true),
    impressions: figure(b.impressions, a.impressions, true),
    ctr: figure(ctrOf(b), ctrOf(a), false),
    position: figure(positionOf(b), positionOf(a), false),
  }
}

function enquiryTotals(days: EnquiryDay[], range: DayRange) {
  const t: Record<'total' | SourceClass, number> = {
    total: 0,
    organic_search: 0,
    ai_assistant: 0,
    other: 0,
  }
  for (const d of days) {
    if (!inRange(d.date, range)) continue
    t.total += d.count
    if (CLASSES.includes(d.sourceClass)) t[d.sourceClass] += d.count
  }
  return t
}

function enquiryResult(
  input: NonNullable<Parameters<typeof compareTarget>[0]['enquiries']> | null,
  day: string,
  today: string,
): EnquiryResult {
  if (!input || !input.enabled) return { status: 'unavailable', reason: 'not_enabled' }

  const v = verdictFor(input.state, day, today)
  if (v.status !== 'comparable') return v

  const w = windowsFor(day)
  const b = enquiryTotals(input.days, w.before)
  const a = enquiryTotals(input.days, w.after)
  return {
    status: 'comparable',
    total: figure(b.total, a.total, true),
    organic_search: figure(b.organic_search, a.organic_search, true),
    ai_assistant: figure(b.ai_assistant, a.ai_assistant, true),
    other: figure(b.other, a.other, true),
    // Withheld data makes the counts a floor, not a wrong answer: the result stays comparable.
    withheld: input.state?.withheld === true,
  }
}

export function compareTarget(input: {
  day: string
  today: string
  withdrawn: boolean
  schemaVersion: number
  measured: boolean
  scope: 'site' | 'page'
  /**
   * Whether a page target is one Search Console syncs (the store reads the sync
   * set listSyncPages takes). Ignored for a whole-site target: the property is
   * always synced.
   */
  pageSynced: boolean
  search: SourceState | null
  searchDays: SearchDay[]
  enquiries: { enabled: boolean; state: SourceState | null; days: EnquiryDay[] } | null
}): TargetResult {
  if (input.withdrawn) return { status: 'withdrawn' }
  if (input.schemaVersion !== 1) return { status: 'not_supported' }
  if (!input.measured) return { status: 'not_measured' }

  let v = verdictFor(input.search, input.day, input.today)
  // A page outside the sync set gets no new rows however healthy the binding is,
  // so no other verdict about it means anything. Only "no binding at all" is the
  // more basic answer, and it stands.
  if (input.scope === 'page' && !input.pageSynced && v.reason !== 'not_bound') {
    v = { status: 'unavailable', reason: 'page_not_synced' }
  }
  const result: TargetResult = { ...v }
  if (v.status === 'comparable') result.search = searchFigures(input.searchDays, input.day)

  // Enquiries sit inside a comparable or not_ready whole-site target. They have
  // their own verdict and are computed apart from the search figures, so a GA4
  // problem can never remove or change them.
  if (input.scope === 'site' && (v.status === 'comparable' || v.status === 'not_ready')) {
    result.enquiries = enquiryResult(input.enquiries, input.day, input.today)
  }
  return result
}
