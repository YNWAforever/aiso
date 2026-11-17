import type { StudioConnection } from '@/lib/conversation-studio/secondary'

export type ConnectionTone = 'ok' | 'pending' | 'neutral' | 'danger'

export type GscConnectionStatus = {
  labelKey: `evidence.sync.${'unbound' | 'awaiting_first_sync' | 'synced' | 'reconnect' | 'access_lost' | 'retrying' | 'rebind' | 'paused_plan' | 'temporarily_unavailable'}` | 'connections.statusUnavailable' | 'connections.statusSyncUnavailable'
  tone: ConnectionTone
  dataThrough: string | null
  showCompleteness: boolean
}

function toneFor(kind: string): ConnectionTone {
  if (kind === 'synced') return 'ok'
  if (kind === 'awaiting_first_sync' || kind === 'retrying') return 'pending'
  if (kind === 'unbound') return 'neutral'
  return 'danger'
}

/**
 * The one status the GSC row may show.
 *
 * A failed owner-state read is not "not connected", and a bound connection
 * without readable state is not "awaiting sync"; each keeps its own label.
 */
export function gscConnectionStatus(connection: Pick<StudioConnection, 'sourceStatus' | 'state'>): GscConnectionStatus {
  const state = connection.state
  if (connection.sourceStatus === 'unavailable') {
    return { labelKey: 'connections.statusUnavailable', tone: 'neutral', dataThrough: null, showCompleteness: false }
  }
  if (connection.sourceStatus === 'unbound') {
    return { labelKey: 'evidence.sync.unbound', tone: 'neutral', dataThrough: null, showCompleteness: false }
  }
  if (connection.sourceStatus === 'reconnect') {
    return { labelKey: 'evidence.sync.reconnect', tone: 'danger', dataThrough: null, showCompleteness: false }
  }
  if (connection.sourceStatus === 'rebind') {
    return { labelKey: 'evidence.sync.rebind', tone: 'danger', dataThrough: null, showCompleteness: false }
  }
  if (!state) {
    return { labelKey: 'connections.statusSyncUnavailable', tone: 'neutral', dataThrough: null, showCompleteness: false }
  }
  return {
    labelKey: `evidence.sync.${state.kind}`,
    tone: toneFor(state.kind),
    dataThrough: 'dataThrough' in state ? state.dataThrough : null,
    showCompleteness: state.kind === 'synced',
  }
}
