/**
 * What the owner sees, derived and never stored (spec §5). `dataThrough` is
 * always the last date that actually synced, so a failure never renders as a
 * zero or erases the history.
 */

export const SYNC_OUTCOMES = [
  'ok', 'revoked', 'access_lost', 'google_unavailable', 'quota',
  'domain_mismatch', 'not_entitled', 'vault_error', 'config_error', 'internal_error',
  // The run's wall-clock deadline arrived before every Google call was made
  // (sync.ts). Carries nothing the owner needs to act on.
  'deferred',
] as const
export type SyncOutcome = (typeof SYNC_OUTCOMES)[number]
export type ConnectionStatus = 'active' | 'needs_reconnect' | 'revoked'

type ProblemKind = 'reconnect' | 'access_lost' | 'retrying' | 'rebind' | 'paused_plan' | 'temporarily_unavailable'

export type OwnerState =
  | { kind: 'unbound' }
  | { kind: 'awaiting_first_sync' }
  | { kind: 'synced'; dataThrough: string }
  | { kind: ProblemKind; dataThrough: string | null }

export type OwnerStateInput = {
  bound: boolean
  entitled: boolean
  connectionStatus: ConnectionStatus | null
  domainMatches: boolean
  /** When the current binding was made or last rebound (ISO). Null only when unbound. */
  boundAt: string | null
  /** The newest ledger row for the brand, of any outcome, with when it was recorded (ISO). */
  latest: { outcome: SyncOutcome; dataThrough: string | null; ranAt: string } | null
  lastGoodDataThrough: string | null
}

/**
 * Outcomes whose current truth deriveOwnerState checks live, BEFORE it reads
 * the ledger — the connection status, the entitlement and the domain. Once
 * those checks have passed, a row saying otherwise describes a past the owner
 * has already fixed (reconnected, upgraded, rebound), not the present. Until
 * the next daily run overwrites it, such a row must not keep telling them to
 * do it again. `deferred` joins them because it carries no information at all:
 * the run simply ran out of time.
 */
const SUPERSEDED_BY_LIVE_CHECK: ReadonlySet<SyncOutcome> = new Set(['revoked', 'not_entitled', 'domain_mismatch', 'deferred'])

type LedgerProblem = Exclude<SyncOutcome, 'ok' | 'revoked' | 'not_entitled' | 'domain_mismatch' | 'deferred'>

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

/**
 * Is the newest ledger row about the binding the owner has now? A row recorded
 * before `bound_at` was written for a previous binding — possibly another
 * property — so what it says (`domain_mismatch`, `access_lost`, even `ok`)
 * is not about this one.
 */
function current(latest: OwnerStateInput['latest'], boundAt: string | null): OwnerStateInput['latest'] {
  if (!latest) return null
  if (boundAt !== null && Date.parse(latest.ranAt) < Date.parse(boundAt)) return null
  if (SUPERSEDED_BY_LIVE_CHECK.has(latest.outcome)) return null
  return latest
}

export function deriveOwnerState(input: OwnerStateInput): OwnerState {
  if (!input.bound) return { kind: 'unbound' }
  const dataThrough = input.lastGoodDataThrough
  if (!input.entitled) return { kind: 'paused_plan', dataThrough }
  if (input.connectionStatus !== 'active') return { kind: 'reconnect', dataThrough }
  if (!input.domainMatches) return { kind: 'rebind', dataThrough }
  // The live checks above all passed. A stale or superseded row reads as if no
  // newer run had happened yet.
  const latest = current(input.latest, input.boundAt)
  if (!latest) return dataThrough ? { kind: 'synced', dataThrough } : { kind: 'awaiting_first_sync' }
  if (latest.outcome === 'ok') {
    const through = latest.dataThrough ?? dataThrough
    return through ? { kind: 'synced', dataThrough: through } : { kind: 'awaiting_first_sync' }
  }
  return { kind: BY_OUTCOME[latest.outcome as LedgerProblem], dataThrough }
}
