import { describe, expect, it } from 'vitest'
import { gscConnectionStatus } from '@/lib/conversation-studio/connection-view'

describe('GSC connection status', () => {
  it('separates a failed status read from a confirmed disconnection', () => {
    expect(gscConnectionStatus({ sourceStatus: 'unavailable', state: null })).toMatchObject({
      labelKey: 'connections.statusUnavailable', tone: 'neutral', showCompleteness: false,
    })
    expect(gscConnectionStatus({ sourceStatus: 'unbound', state: null })).toMatchObject({
      labelKey: 'evidence.sync.unbound', tone: 'neutral',
    })
  })

  it('does not turn a bound connection with no readable owner state into awaiting sync', () => {
    expect(gscConnectionStatus({ sourceStatus: 'bound', state: null })).toMatchObject({
      labelKey: 'connections.statusSyncUnavailable', tone: 'neutral', showCompleteness: false,
    })
  })

  it('shows one state for a synced connection and exposes its data date', () => {
    expect(gscConnectionStatus({ sourceStatus: 'bound', state: { kind: 'synced', dataThrough: '2026-10-26' } })).toEqual({
      labelKey: 'evidence.sync.synced', tone: 'ok', dataThrough: '2026-10-26', showCompleteness: true,
    })
  })

  it('keeps awaiting-first-sync, retry and problem states distinct', () => {
    expect(gscConnectionStatus({ sourceStatus: 'bound', state: { kind: 'awaiting_first_sync' } }).tone).toBe('pending')
    expect(gscConnectionStatus({ sourceStatus: 'bound', state: { kind: 'retrying', dataThrough: null } }).tone).toBe('pending')
    expect(gscConnectionStatus({ sourceStatus: 'bound', state: { kind: 'reconnect', dataThrough: '2026-10-20' } })).toMatchObject({
      labelKey: 'evidence.sync.reconnect', tone: 'danger', dataThrough: '2026-10-20', showCompleteness: false,
    })
    expect(gscConnectionStatus({ sourceStatus: 'bound', state: { kind: 'temporarily_unavailable', dataThrough: null } })).toMatchObject({
      labelKey: 'evidence.sync.temporarily_unavailable', tone: 'danger',
    })
  })

  it('maps the older source-status values without duplicating the badge', () => {
    expect(gscConnectionStatus({ sourceStatus: 'reconnect', state: null }).labelKey).toBe('evidence.sync.reconnect')
    expect(gscConnectionStatus({ sourceStatus: 'rebind', state: null }).labelKey).toBe('evidence.sync.rebind')
  })
})
