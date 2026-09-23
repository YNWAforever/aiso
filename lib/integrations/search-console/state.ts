/**
 * What the owner sees, derived and never stored (spec §5). `dataThrough` is
 * always the last date that actually synced, so a failure never renders as a
 * zero or erases the history.
 */

export const SYNC_OUTCOMES = [
  'ok', 'revoked', 'access_lost', 'google_unavailable', 'quota',
  'domain_mismatch', 'not_entitled', 'vault_error', 'config_error',
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
  latest: { outcome: SyncOutcome; dataThrough: string | null } | null
  lastGoodDataThrough: string | null
}

const BY_OUTCOME: Record<Exclude<SyncOutcome, 'ok'>, ProblemKind> = {
  revoked: 'reconnect',
  access_lost: 'access_lost',
  google_unavailable: 'retrying',
  quota: 'retrying',
  domain_mismatch: 'rebind',
  not_entitled: 'paused_plan',
  vault_error: 'temporarily_unavailable',
  // Our Google client or Cloud project is misconfigured: never the owner's to fix.
  config_error: 'temporarily_unavailable',
}

export function deriveOwnerState(input: OwnerStateInput): OwnerState {
  if (!input.bound) return { kind: 'unbound' }
  const dataThrough = input.lastGoodDataThrough
  if (!input.entitled) return { kind: 'paused_plan', dataThrough }
  if (input.connectionStatus !== 'active') return { kind: 'reconnect', dataThrough }
  if (!input.domainMatches) return { kind: 'rebind', dataThrough }
  if (!input.latest) return dataThrough ? { kind: 'synced', dataThrough } : { kind: 'awaiting_first_sync' }
  if (input.latest.outcome === 'ok') {
    const through = input.latest.dataThrough ?? dataThrough
    return through ? { kind: 'synced', dataThrough: through } : { kind: 'awaiting_first_sync' }
  }
  return { kind: BY_OUTCOME[input.latest.outcome], dataThrough }
}
