import { resolveCommercialEntitlement } from '@/lib/tier'
import { acquireAccessToken, type TokenDeps } from '@/lib/integrations/google/access'
import { GoogleApiError } from '@/lib/integrations/google/oauth'
import { ANALYTICS_SCOPE, hasScope } from '@/lib/integrations/google/scopes'
import { DeadlineReachedError } from '@/lib/integrations/search-console/client'
import { AnalyticsApiError, type KeyEventRow, type runKeyEventReport } from './client'
import { streamEligibility, streamStillMatches, type WebStream } from './binding'
import { classifySource, type SourceClass } from './sources'
import type { AnalyticsOutcome } from './state'
import type { DailyCount, DueAnalyticsBinding, recordAnalyticsRun, replaceDailyWindow } from './store'

/**
 * Sync one brand's GA4 key events and say exactly what happened. Every dependency
 * is injected, so the whole decision table is unit-tested with no Google and no
 * database. A ledger row is written for every outcome, skips included: the owner's
 * screen is derived from it.
 *
 * Same shape as the Search Console sync, and for the same reason: the ledger row
 * is written exactly once, from ONE call site, after `attempt()` returns or
 * throws. The cron runs bindings least recently attempted first, so an error that
 * escaped would abort the run and starve every brand behind it forever.
 *
 * THE CROSS-PRODUCT RULE. One Google connection carries both products' grants. A
 * GA4 failure of any kind, including a missing `analytics.readonly` scope or an
 * Analytics API 403, must never flip that connection: Search Console still works
 * on it. Only a refresh `invalid_grant` means the grant is gone, and
 * `acquireAccessToken` is the one place that acts on it. This file never calls
 * `markConnection` at all.
 */

export const BACKFILL_DAYS = 90
export const ROUTINE_DAYS = 7
/** Days before the last ok run that a gap-closing window re-fetches, for data GA4 had not finished processing. */
export const RECHECK_DAYS = 2

export type AnalyticsSyncDeps = TokenDeps & {
  /** Null when the property has no such web stream (any more). */
  getStream(token: string, propertyId: string, streamId: string): Promise<WebStream | null>
  listKeyEvents(token: string, propertyId: string): Promise<string[]>
  report(token: string, input: Parameters<typeof runKeyEventReport>[1]): Promise<{ rows: KeyEventRow[]; withheld: boolean }>
  replaceDailyWindow: typeof replaceDailyWindow
  recordRun: typeof recordAnalyticsRun
  today(): string
  /**
   * Epoch ms after which no further Google call is started (cron: run start +
   * 45 s). Checked before every call, and handed to the report, which checks it
   * between pages.
   */
  deadline: number
  /** The clock the deadline is read against. Defaults to Date.now. */
  now?: () => number
}

type AttemptResult = { outcome: AnalyticsOutcome; rows: number; through: string | null; withheld: boolean }

const stop = (outcome: AnalyticsOutcome): AttemptResult => ({ outcome, rows: 0, through: null, withheld: false })

const OUTCOME_FOR: Record<AnalyticsApiError['kind'], AnalyticsOutcome> = {
  // Only ever a missing analytics scope: the connection itself is untouched.
  scope_missing: 'scope_missing',
  access_lost: 'access_lost',
  quota: 'quota',
  unavailable: 'google_unavailable',
  // Our Cloud project has the Analytics API disabled, or the request itself is wrong.
  misconfigured: 'config_error',
}

function daysBefore(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

type SyncWindow = {
  startDate: string
  endDate: string
  /**
   * True when this window does not continue the stored range: a backfill, or a
   * routine run with no ok run within reach. Coverage then restarts at startDate,
   * if the run turns out ok.
   */
  restart: boolean
}

/**
 * The routine window reaches back to the last ok run, so a run of failed syncs
 * (quota, outage, deferred) leaves no hole in stored history: GA4 omits zero-event
 * days, so a missing day inside the covered range is read as a real zero and the
 * range must be one unbroken stretch from covered_from. The window starts
 * RECHECK_DAYS before `lastOkDate`, not at it: that run fetched its own day while it
 * was still in progress and the two days before it before GA4 had finished
 * processing them, so re-fetching only from lastOkDate would leave late-arriving
 * enquiries on those days missing, as real-looking zeros inside the covered range.
 * (A daily 7-day window fetches each day about 7 times; only an outage longer than
 * that needs the margin.) The margin only adds re-fetching, never a hole, and is
 * bounded below by the 90-day floor. With no ok run, or one older than the floor,
 * the hole is real, the new window is not contiguous with what was stored, and
 * coverage restarts at its start.
 */
function windowFor(b: DueAnalyticsBinding, endDate: string): SyncWindow {
  const floor = daysBefore(endDate, BACKFILL_DAYS - 1)
  const routineStart = daysBefore(endDate, ROUTINE_DAYS - 1)
  if (b.backfillPending || b.lastOkDate === null || b.lastOkDate < floor) {
    return { startDate: floor, endDate, restart: true }
  }
  const margin = daysBefore(b.lastOkDate, RECHECK_DAYS)
  const reach = margin < routineStart ? margin : routineStart
  return { startDate: reach < floor ? floor : reach, endDate, restart: false }
}

/** String properties are read this way for an unknown thrown value without assuming it is an Error. */
function stringProp(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = (value as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

/**
 * One row per (date, event, source class). The store inserts exactly what it is
 * given and the table's unique key rejects a duplicate, so the sum happens here:
 * GA4 returns one row per source, and several sources share a class.
 */
function aggregate(rows: KeyEventRow[]): DailyCount[] {
  const byKey = new Map<string, DailyCount>()
  for (const r of rows) {
    const sourceClass: SourceClass = classifySource(r.source, r.channelGroup)
    const key = JSON.stringify([r.date, r.eventName, sourceClass])
    const existing = byKey.get(key)
    if (existing) existing.count += r.count
    else byKey.set(key, { date: r.date, eventName: r.eventName, sourceClass, count: r.count })
  }
  return [...byKey.values()]
}

/**
 * Everything that decides an outcome, without writing the ledger. Throws for
 * anything it does not itself classify: the one caller, `syncAnalyticsBinding`,
 * turns that into `internal_error`.
 */
async function attempt(b: DueAnalyticsBinding, deps: AnalyticsSyncDeps, window: SyncWindow): Promise<AttemptResult> {
  if (!resolveCommercialEntitlement(b.account).features.analytics) return stop('not_entitled')
  // Before any Google call: a brand whose domain moved must not have another site's numbers pulled under its name.
  if (!streamStillMatches(b.streamHost, b.currentDomain)) return stop('domain_mismatch')

  const { startDate, endDate } = window
  const clock = deps.now ?? Date.now
  const outOfTime = () => clock() >= deps.deadline

  // Inside the try so a refresh GoogleApiError that acquireAccessToken does not
  // classify (`forbidden`) lands in the catch below as access_lost. Every other
  // refresh failure comes back as a TokenResult.
  try {
    const token = await acquireAccessToken(deps, {
      accountId: b.accountId, connectionId: b.connectionId, clientId: b.clientId, outOfTime, logTag: '[analytics]',
    })
    if (!token.ok) return stop(token.outcome)
    // Not a connection problem, so nothing is marked: the owner grants the scope, and Search Console carries on meanwhile.
    if (!hasScope(token.scopes, ANALYTICS_SCOPE)) return stop('scope_missing')
    const accessToken = token.accessToken

    if (outOfTime()) return stop('deferred')
    const stream = await deps.getStream(accessToken, b.propertyId, b.streamId)
    if (!stream) return stop('access_lost')
    // The stored host was checked above, but GA4 lets an admin re-point a stream at
    // another site without changing its id. Re-run the same eligibility on the LIVE
    // default URI, or that site's conversions would keep landing under this brand.
    if (!streamEligibility(stream.defaultUri, b.currentDomain).eligible) return stop('domain_mismatch')

    if (outOfTime()) return stop('deferred')
    const liveKeyEvents = new Set(await deps.listKeyEvents(accessToken, b.propertyId))
    // Exact, case-sensitive: GA4 spells `Generate_Lead` and `generate_lead` as two events.
    const validEvents = b.keyEvents.filter(e => liveKeyEvents.has(e))
    if (validEvents.length === 0) return stop('events_missing')

    const { rows, withheld } = await deps.report(accessToken, {
      propertyId: b.propertyId, streamId: b.streamId, eventNames: validEvents,
      startDate, endDate, deadline: deps.deadline, now: deps.now,
    })

    // The report filters server-side, but its rows are not trusted to be only ours:
    // `(other)` and a differently cased name would otherwise be stored as conversions.
    const wanted = new Set(validEvents)
    const kept = rows.filter(r => wanted.has(r.eventName))
    const written = await deps.replaceDailyWindow(b.accountId, b.clientId, { startDate, endDate }, aggregate(kept))
    // The window end this run asked for, rows or not. GA4's runReport omits days
    // with no events, so the newest returned date says only when the last enquiry
    // happened, not how far the data runs: a brand with no enquiries would never
    // leave awaiting_first_sync, and one whose last enquiry was weeks ago would be
    // shown as weeks stale. The panel anchors its 28 days on this value.
    // `withheld` also covers "stopped at the page cap": either way the counts are a lower bound.
    return { outcome: 'ok', rows: written, through: endDate, withheld }
  } catch (error) {
    if (error instanceof DeadlineReachedError) return stop('deferred')
    if (error instanceof AnalyticsApiError) {
      if (error.kind === 'misconfigured') {
        console.error('[analytics] google misconfigured', { clientId: b.clientId, status: error.status, code: error.code })
      }
      return stop(OUTCOME_FOR[error.kind])
    }
    // The refresh's own failures never reach here except `forbidden`; any other
    // GoogleApiError is unexpected here and is internal_error like the rest.
    if (error instanceof GoogleApiError && error.kind === 'forbidden') return stop('access_lost')
    throw error
  }
}

export async function syncAnalyticsBinding(b: DueAnalyticsBinding, deps: AnalyticsSyncDeps): Promise<AnalyticsOutcome> {
  let result: AttemptResult
  // Read once, here: the window the attempt fetched and the window the ledger records are the same.
  const window = windowFor(b, deps.today())
  try {
    result = await attempt(b, deps, window)
  } catch (error) {
    // Never log error.message: the Neon driver can echo the full connection
    // string, password included, into some of its own error messages.
    console.error('[analytics] sync failed', {
      clientId: b.clientId,
      name: error instanceof Error ? error.name : typeof error,
      code: stringProp(error, 'code'),
    })
    result = stop('internal_error')
  }

  // recordRun is allowed to throw and propagate: a failure to write the ledger row is not something this function can paper over.
  await deps.recordRun({
    accountId: b.accountId, clientId: b.clientId, connectionId: b.connectionId,
    propertyId: b.propertyId, streamId: b.streamId,
    // The value loaded before syncing, so a re-pick of the events mid-sync keeps its own pending backfill.
    eventsChosenAt: b.eventsChosenAt,
    outcome: result.outcome, rowsWritten: result.rows, dataThrough: result.through,
    dataWithheld: result.withheld,
    clearBackfill: result.outcome === 'ok',
    // Coverage restarts only for an ok run whose window is not contiguous with the stored range.
    // Only the store knows whether a re-pick or rebind mid-sync voids it (the same guard as the backfill flag).
    windowStart: window.startDate,
    restartCoverage: result.outcome === 'ok' && window.restart,
  })
  return result.outcome
}
