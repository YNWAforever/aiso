import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_SYNC_OUTCOMES,
  deriveAnalyticsOwnerState,
  type AnalyticsStateInput,
} from '@/lib/integrations/analytics/state'

const BOUND_AT = '2026-09-01T00:00:00.000Z'
const EVENTS_AT = '2026-09-05T00:00:00.000Z'
const RAN_AT = '2026-09-21T09:00:00.000Z'

const base: AnalyticsStateInput = {
  bound: true, entitled: true, connectionStatus: 'active',
  hasAnalyticsScope: true, domainMatches: true,
  boundAt: BOUND_AT, eventsChosenAt: EVENTS_AT,
  latest: { outcome: 'ok', dataThrough: '2026-09-20', ranAt: RAN_AT },
  lastGoodDataThrough: '2026-09-20',
}

const row = (outcome: (typeof ANALYTICS_SYNC_OUTCOMES)[number], ranAt = RAN_AT) =>
  ({ outcome, dataThrough: null, ranAt })

describe('ANALYTICS_SYNC_OUTCOMES', () => {
  it('is the closed vocabulary, in order', () => {
    expect([...ANALYTICS_SYNC_OUTCOMES]).toEqual([
      'ok', 'revoked', 'access_lost', 'google_unavailable', 'quota',
      'domain_mismatch', 'not_entitled', 'vault_error', 'config_error', 'internal_error',
      'deferred', 'scope_missing', 'events_missing',
    ])
  })

  it('is handled in full by the derivation', () => {
    for (const outcome of ANALYTICS_SYNC_OUTCOMES) {
      expect(deriveAnalyticsOwnerState({ ...base, latest: row(outcome) }).kind).toBeTypeOf('string')
    }
  })
})

describe('deriveAnalyticsOwnerState precedence', () => {
  it('is unbound before a property is chosen, ahead of everything else', () => {
    expect(deriveAnalyticsOwnerState({
      ...base, bound: false, entitled: false, connectionStatus: null, hasAnalyticsScope: false, domainMatches: false,
    })).toEqual({ kind: 'unbound' })
  })

  it('is paused_plan when not entitled, keeping the last good date', () => {
    expect(deriveAnalyticsOwnerState({
      ...base, entitled: false, connectionStatus: 'revoked', hasAnalyticsScope: false, domainMatches: false,
    })).toEqual({ kind: 'paused_plan', dataThrough: '2026-09-20' })
  })

  it.each(['needs_reconnect', 'revoked', null] as const)('asks to reconnect when the connection is %s', connectionStatus => {
    expect(deriveAnalyticsOwnerState({ ...base, connectionStatus, hasAnalyticsScope: false, domainMatches: false }))
      .toEqual({ kind: 'reconnect', dataThrough: '2026-09-20' })
  })

  it('asks to grant Analytics when the scope is missing, ahead of a domain mismatch', () => {
    expect(deriveAnalyticsOwnerState({ ...base, hasAnalyticsScope: false, domainMatches: false }))
      .toEqual({ kind: 'grant_analytics' })
  })

  it('asks to rebind when the domain no longer matches', () => {
    expect(deriveAnalyticsOwnerState({ ...base, domainMatches: false }))
      .toEqual({ kind: 'rebind', dataThrough: '2026-09-20' })
  })

  it('says synced with the date after an ok run', () => {
    expect(deriveAnalyticsOwnerState(base)).toEqual({ kind: 'synced', dataThrough: '2026-09-20' })
  })

  it('waits for the first sync when there is no row and no good date', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: null, lastGoodDataThrough: null }))
      .toEqual({ kind: 'awaiting_first_sync' })
  })

  it('reads an absent row as synced when a good date exists', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: null }))
      .toEqual({ kind: 'synced', dataThrough: '2026-09-20' })
  })

  it('uses the last good date when the ok run recorded none', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('ok'), lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind: 'synced', dataThrough: '2026-09-18' })
  })

  it('awaits the first sync when an ok run and the last good date are both absent', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('ok'), lastGoodDataThrough: null }))
      .toEqual({ kind: 'awaiting_first_sync' })
  })

  it('asks to repick events after an events_missing run since the events were chosen', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('events_missing'), lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind: 'repick_events' })
  })

  it.each([
    ['access_lost', 'access_lost'],
    ['google_unavailable', 'retrying'],
    ['quota', 'retrying'],
    ['vault_error', 'temporarily_unavailable'],
    ['config_error', 'temporarily_unavailable'],
    ['internal_error', 'temporarily_unavailable'],
  ] as const)('maps a %s run to %s, keeping the last good date', (outcome, kind) => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row(outcome), lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind, dataThrough: '2026-09-18' })
  })

  it('carries a null date on a problem state when nothing ever synced', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('quota'), lastGoodDataThrough: null }))
      .toEqual({ kind: 'retrying', dataThrough: null })
  })
})

describe('stale ledger rows', () => {
  it('ignores a row recorded before the binding was (re)made', () => {
    expect(deriveAnalyticsOwnerState({
      ...base, boundAt: '2026-09-22T00:00:00.000Z', latest: row('access_lost'), lastGoodDataThrough: null,
    })).toEqual({ kind: 'awaiting_first_sync' })
  })

  it('ignores a pre-bind ok row rather than trusting its date', () => {
    expect(deriveAnalyticsOwnerState({
      ...base,
      boundAt: '2026-09-22T00:00:00.000Z',
      latest: { outcome: 'ok', dataThrough: '2026-09-19', ranAt: RAN_AT },
      lastGoodDataThrough: null,
    })).toEqual({ kind: 'awaiting_first_sync' })
  })

  it('compares timestamps as instants, not strings', () => {
    // Lexically '...+08:00' > '...Z', but as instants the row (01:00Z) precedes boundAt (02:00Z).
    expect(deriveAnalyticsOwnerState({
      ...base,
      boundAt: '2026-09-22T02:00:00.000Z',
      latest: row('access_lost', '2026-09-22T09:00:00.000+08:00'),
      lastGoodDataThrough: null,
    })).toEqual({ kind: 'awaiting_first_sync' })
  })

  it('does not ignore a row recorded exactly at boundAt', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('access_lost', BOUND_AT), lastGoodDataThrough: null }))
      .toEqual({ kind: 'access_lost', dataThrough: null })
  })

  it('ignores a scope_missing row once the scope is present', () => {
    expect(deriveAnalyticsOwnerState({ ...base, hasAnalyticsScope: true, latest: row('scope_missing'), lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind: 'synced', dataThrough: '2026-09-18' })
  })

  it('awaits the first sync when a stale scope_missing row has no good date', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('scope_missing'), lastGoodDataThrough: null }))
      .toEqual({ kind: 'awaiting_first_sync' })
  })

  it('ignores an events_missing row from before the events were chosen', () => {
    expect(deriveAnalyticsOwnerState({
      ...base, eventsChosenAt: '2026-09-22T00:00:00.000Z', latest: row('events_missing'), lastGoodDataThrough: '2026-09-18',
    })).toEqual({ kind: 'synced', dataThrough: '2026-09-18' })
  })

  it('compares events_chosen_at as an instant too', () => {
    expect(deriveAnalyticsOwnerState({
      ...base,
      eventsChosenAt: '2026-09-22T02:00:00.000Z',
      latest: row('events_missing', '2026-09-22T09:00:00.000+08:00'),
      lastGoodDataThrough: null,
    })).toEqual({ kind: 'awaiting_first_sync' })
  })

  it('keeps an events_missing row when no event choice time is recorded', () => {
    expect(deriveAnalyticsOwnerState({ ...base, eventsChosenAt: null, latest: row('events_missing') }))
      .toEqual({ kind: 'repick_events' })
  })

  it('does not tell an upgraded owner they are off Pro over a stale not_entitled row', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('not_entitled'), lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind: 'synced', dataThrough: '2026-09-18' })
  })

  it('asks to rebind over a current domain_mismatch row even though the stored host still matches', () => {
    // The sync records this when the LIVE stream was re-pointed at another site: the stored host is unchanged, so domainMatches is true.
    expect(deriveAnalyticsOwnerState({ ...base, domainMatches: true, latest: row('domain_mismatch'), lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind: 'rebind', dataThrough: '2026-09-18' })
  })

  it('carries a null date on a current domain_mismatch row when nothing ever synced', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('domain_mismatch'), lastGoodDataThrough: null }))
      .toEqual({ kind: 'rebind', dataThrough: null })
  })

  it('treats a domain_mismatch row recorded exactly at boundAt as current', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('domain_mismatch', BOUND_AT), lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind: 'rebind', dataThrough: '2026-09-18' })
  })

  it('a rebind clears a domain_mismatch row: one from before boundAt is stale and reads as synced', () => {
    expect(deriveAnalyticsOwnerState({
      ...base, boundAt: '2026-09-22T00:00:00.000Z', latest: row('domain_mismatch'), lastGoodDataThrough: '2026-09-18',
    })).toEqual({ kind: 'synced', dataThrough: '2026-09-18' })
  })

  it('a stale domain_mismatch row with no good date reads as awaiting the first sync', () => {
    expect(deriveAnalyticsOwnerState({
      ...base, boundAt: '2026-09-22T00:00:00.000Z', latest: row('domain_mismatch'), lastGoodDataThrough: null,
    })).toEqual({ kind: 'awaiting_first_sync' })
  })

  it('does not re-ask a reconnected owner to reconnect over a stale revoked row', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('revoked'), lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind: 'synced', dataThrough: '2026-09-18' })
  })

  it('reads a deferred row as synced when an earlier run succeeded', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('deferred'), lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind: 'synced', dataThrough: '2026-09-18' })
  })

  it('reads a deferred row as awaiting the first sync when nothing has succeeded', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('deferred'), lastGoodDataThrough: null }))
      .toEqual({ kind: 'awaiting_first_sync' })
  })

  it('still reports a failure recorded after the binding was made', () => {
    expect(deriveAnalyticsOwnerState({ ...base, latest: row('access_lost'), lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind: 'access_lost', dataThrough: '2026-09-18' })
  })
})
