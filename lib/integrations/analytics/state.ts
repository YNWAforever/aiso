/**
 * What the owner sees for the GA4 connector, derived and never stored (spec §5).
 * `dataThrough` on a problem state is always the last date that actually synced,
 * so a failure never renders as a zero or erases the history.
 *
 * Deliberately independent of search-console/state.ts: the two products share a
 * pattern, not a module, and each vocabulary is pinned to its own DB CHECK.
 */

export const ANALYTICS_SYNC_OUTCOMES = [
  'ok', 'revoked', 'access_lost', 'google_unavailable', 'quota',
  'domain_mismatch', 'not_entitled', 'vault_error', 'config_error', 'internal_error',
  // The run's wall-clock deadline arrived before every Google call was made.
  // Carries nothing the owner needs to act on.
  'deferred',
  // The connection lacks analytics.readonly.
  'scope_missing',
  // None of the chosen events is a key event any more.
  'events_missing',
] as const
export type AnalyticsOutcome = (typeof ANALYTICS_SYNC_OUTCOMES)[number]

type ProblemKind = 'reconnect' | 'access_lost' | 'retrying' | 'rebind' | 'paused_plan' | 'temporarily_unavailable'

export type AnalyticsOwnerState =
  | { kind: 'unbound' }
  | { kind: 'grant_analytics' }
  | { kind: 'awaiting_first_sync' }
  | { kind: 'synced'; dataThrough: string }
  | { kind: 'repick_events' }
  | { kind: ProblemKind; dataThrough: string | null }

export type AnalyticsStateInput = {
  bound: boolean
  entitled: boolean
  connectionStatus: 'active' | 'needs_reconnect' | 'revoked' | null
  hasAnalyticsScope: boolean
  domainMatches: boolean
  /** When the current binding was made or last rebound (ISO). Null only when unbound. */
  boundAt: string | null
  /** When the owner last saved their chosen events (ISO). */
  eventsChosenAt: string | null
  /** The newest ledger row for the brand, of any outcome, with when it was recorded (ISO). */
  latest: { outcome: AnalyticsOutcome; dataThrough: string | null; ranAt: string } | null
  lastGoodDataThrough: string | null
}

/**
 * Outcomes whose current truth deriveAnalyticsOwnerState checks live, BEFORE it
 * reads the ledger (entitlement, connection status, domain). Once those checks
 * have passed, a row saying otherwise describes a past the owner has already
 * fixed. `deferred` joins them because it carries no information at all: the
 * run simply ran out of time. `scope_missing` is the same idea for the scope
 * check, but it is conditional and handled separately in `current`.
 */
const SUPERSEDED_BY_LIVE_CHECK: ReadonlySet<AnalyticsOutcome> = new Set(['revoked', 'not_entitled', 'domain_mismatch', 'deferred'])

type LedgerProblem = Exclude<AnalyticsOutcome, 'ok' | 'revoked' | 'not_entitled' | 'domain_mismatch' | 'deferred' | 'scope_missing' | 'events_missing'>

const BY_OUTCOME: Record<LedgerProblem, ProblemKind> = {
  access_lost: 'access_lost',
  google_unavailable: 'retrying',
  quota: 'retrying',
  vault_error: 'temporarily_unavailable',
  // Our Google client or Cloud project is misconfigured: never the owner's to fix.
  config_error: 'temporarily_unavailable',
  // An unexpected failure on our side; never the owner's to fix.
  internal_error: 'temporarily_unavailable',
}

/** Instants, not strings: offsets and fractional seconds must not decide order. */
function before(a: string, b: string | null): boolean {
  return b !== null && Date.parse(a) < Date.parse(b)
}

/**
 * Is the newest ledger row about the state the owner has now? A row recorded
 * before `bound_at` was written for a previous binding, and an `events_missing`
 * row from before the events were last chosen describes a choice that no
 * longer exists.
 */
function current(input: AnalyticsStateInput): AnalyticsStateInput['latest'] {
  const { latest } = input
  if (!latest) return null
  if (before(latest.ranAt, input.boundAt)) return null
  if (SUPERSEDED_BY_LIVE_CHECK.has(latest.outcome)) return null
  // Reached only with the scope present (the live check earlier already
  // returned grant_analytics otherwise), so the row is contradicted.
  if (latest.outcome === 'scope_missing' && input.hasAnalyticsScope) return null
  if (latest.outcome === 'events_missing' && before(latest.ranAt, input.eventsChosenAt)) return null
  return latest
}

export function deriveAnalyticsOwnerState(input: AnalyticsStateInput): AnalyticsOwnerState {
  if (!input.bound) return { kind: 'unbound' }
  const dataThrough = input.lastGoodDataThrough
  if (!input.entitled) return { kind: 'paused_plan', dataThrough }
  if (input.connectionStatus !== 'active') return { kind: 'reconnect', dataThrough }
  if (!input.hasAnalyticsScope) return { kind: 'grant_analytics' }
  if (!input.domainMatches) return { kind: 'rebind', dataThrough }
  // The live checks above all passed. A stale or superseded row reads as if no
  // newer run had happened yet.
  const latest = current(input)
  if (!latest) return dataThrough ? { kind: 'synced', dataThrough } : { kind: 'awaiting_first_sync' }
  if (latest.outcome === 'ok') {
    const through = latest.dataThrough ?? dataThrough
    return through ? { kind: 'synced', dataThrough: through } : { kind: 'awaiting_first_sync' }
  }
  if (latest.outcome === 'events_missing') return { kind: 'repick_events' }
  return { kind: BY_OUTCOME[latest.outcome as LedgerProblem], dataThrough }
}
