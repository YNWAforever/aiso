import { describe, expect, it } from 'vitest'
import { SYNC_OUTCOMES, deriveOwnerState, type OwnerStateInput } from '@/lib/integrations/search-console/state'

const base: OwnerStateInput = {
  bound: true, entitled: true, connectionStatus: 'active', domainMatches: true,
  latest: { outcome: 'ok', dataThrough: '2026-09-20' }, lastGoodDataThrough: '2026-09-20',
}

describe('deriveOwnerState', () => {
  it('is unbound before a property is chosen', () => {
    expect(deriveOwnerState({ ...base, bound: false })).toEqual({ kind: 'unbound' })
  })

  it('waits for the first sync', () => {
    expect(deriveOwnerState({ ...base, latest: null, lastGoodDataThrough: null })).toEqual({ kind: 'awaiting_first_sync' })
  })

  it('shows synced data with its date', () => {
    expect(deriveOwnerState(base)).toEqual({ kind: 'synced', dataThrough: '2026-09-20' })
  })

  it.each([
    ['revoked', 'reconnect'],
    ['access_lost', 'access_lost'],
    ['google_unavailable', 'retrying'],
    ['quota', 'retrying'],
    ['domain_mismatch', 'rebind'],
    ['not_entitled', 'paused_plan'],
    ['vault_error', 'temporarily_unavailable'],
    ['config_error', 'temporarily_unavailable'],
  ] as const)('maps a %s run to %s, keeping the last good date', (outcome, kind) => {
    expect(deriveOwnerState({ ...base, latest: { outcome, dataThrough: null }, lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind, dataThrough: '2026-09-18' })
  })

  it('says the plan lapsed even when the last run was fine', () => {
    expect(deriveOwnerState({ ...base, entitled: false })).toEqual({ kind: 'paused_plan', dataThrough: '2026-09-20' })
  })

  it('asks to reconnect when the connection needs it, whatever the ledger says', () => {
    expect(deriveOwnerState({ ...base, connectionStatus: 'needs_reconnect' })).toEqual({ kind: 'reconnect', dataThrough: '2026-09-20' })
  })

  it('asks to rebind when the domain changed since the last run', () => {
    expect(deriveOwnerState({ ...base, domainMatches: false })).toEqual({ kind: 'rebind', dataThrough: '2026-09-20' })
  })

  it('handles every outcome in the closed vocabulary', () => {
    for (const outcome of SYNC_OUTCOMES) {
      expect(deriveOwnerState({ ...base, latest: { outcome, dataThrough: null } }).kind).toBeTypeOf('string')
    }
  })
})
