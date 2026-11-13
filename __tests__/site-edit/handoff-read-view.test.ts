import { describe, expect, it } from 'vitest'
import {
  acceptHandoffMutation, acceptHandoffRead, beginHandoffMutation, beginHandoffRead, currentHandoffRequest,
  decodeHandoff, failHandoffMutation, failHandoffRead, handoffCanCheck, handoffCanSend,
  handoffPrimaryAction, handoffResponseError, handoffTimestamp, initialHandoffReadState, isHandoffTimestamp,
  type HandoffReadState, type HandoffReadView,
} from '@/lib/site-edit/handoff-read-view'

const at = '2026-11-13T17:00:00.123456Z'
const jobId = '123e4567-e89b-42d3-a456-426614174000'
function view(overrides: Partial<HandoffReadView> = {}): HandoffReadView {
  return { state: 'none', jobId: null, executorRef: null, lastEventAt: null, canSend: true, block: null,
    receipt: null, liveCheck: null, canCheck: false, checkBlock: 'not_open', ...overrides }
}
const sent = (overrides: Partial<HandoffReadView> = {}) => view({ state: 'sent', jobId, lastEventAt: at, block: 'already_sent', canSend: false, canCheck: true, checkBlock: null, ...overrides })
const checked = (overrides: Partial<NonNullable<HandoffReadView['liveCheck']>> = {}) => ({ outcome: 'found' as const, checkedAt: at, attested: false, structuredData: null, ...overrides })
function ready(handoff = view()): HandoffReadState {
  const read = beginHandoffRead(initialHandoffReadState())!
  return acceptHandoffRead(read.state, read.token, decodeHandoff({ handoff }), false)!.state
}

describe('handoff browser decoder', () => {
  it.each(['none', 'sending', 'sent', 'failed', 'unknown'] as const)('reads the actual closed state vocabulary: %s', state => {
    const handoff = view({ state, jobId: state === 'none' ? null : jobId, lastEventAt: state === 'none' ? null : at })
    expect(decodeHandoff({ handoff })).toEqual(handoff)
  })
  it('validates and copies all fields without depending on property order or extra envelope fields', () => {
    const handoff = sent({ executorRef: '<script>reference</script>', receipt: { status: 'completed', completedAt: at }, liveCheck: checked({ structuredData: 'pass' }) })
    const parsed = decodeHandoff({ check: { irrelevant: true }, handoff: { ...handoff, receipt: { completedAt: at, status: 'completed' }, extra: 'ignored' } })
    expect(parsed).toEqual(handoff)
    expect(parsed).not.toBe(handoff)
    expect(parsed.receipt).not.toBe(handoff.receipt)
    expect(parsed.liveCheck).not.toBe(handoff.liveCheck)
  })
  it.each([null, [], {}, { handoff: [] }, { handoff: null }])('rejects missing/malformed envelopes: %j', body => {
    expect(() => decodeHandoff(body)).toThrow()
  })
  it.each([
    { state: 'accepted' }, { canSend: 'true' }, { canSend: true, block: 'not_approver' }, { canSend: false, block: null },
    { canCheck: 'false' }, { canCheck: true, checkBlock: 'too_soon' }, { canCheck: false, checkBlock: null },
    { block: 'approved' }, { checkBlock: 'wait' }, { jobId: 'invented-job' }, { executorRef: 5 }, { executorRef: '' },
    { executorRef: 'x'.repeat(201) }, { executorRef: 'bad\nreference' }, { lastEventAt: '2026-11-13' },
    { receipt: {} }, { receipt: { status: 'verified', completedAt: at } }, { receipt: { status: 'completed', completedAt: 'invalid' } },
    { liveCheck: {} }, { liveCheck: checked({ outcome: 'verified' as 'found' }) }, { liveCheck: { ...checked(), attested: 'false' } },
    { liveCheck: { ...checked(), structuredData: 'unknown' } }, { liveCheck: { ...checked(), checkedAt: '2026-11-13T17:00:00' } },
    { liveCheck: checked({ outcome: 'fetch_failed', attested: true }) }, { liveCheck: checked({ outcome: 'fetch_failed', structuredData: 'pass' }) },
  ])('fails closed on malformed public fields: %j', overrides => {
    expect(() => decodeHandoff({ handoff: { ...sent(), ...overrides } })).toThrow()
  })
  it.each(['jobId', 'executorRef', 'lastEventAt', 'receipt', 'liveCheck', 'canCheck', 'checkBlock'])('requires nullable fields to be explicit: %s', field => {
    const handoff: Record<string, unknown> = { ...view() }
    delete handoff[field]
    expect(() => decodeHandoff({ handoff })).toThrow()
  })
  it('rejects recorded checks/receipts and check authority without a job', () => {
    for (const handoff of [sent({ jobId: null }), view({ receipt: { status: 'completed', completedAt: at } }), view({ liveCheck: checked() })]) {
      expect(() => decodeHandoff({ handoff })).toThrow()
    }
  })
  it.each(['pass', 'warn', 'fail', null] as const)('accepts stored structured-data observation %s independently of delivery insertion', structuredData => {
    expect(decodeHandoff({ handoff: sent({ liveCheck: checked({ structuredData }) }) }).liveCheck?.attested).toBe(false)
  })
  it('requires the successful check write receipt as well as a complete handoff view', () => {
    const handoff = sent({ liveCheck: checked() })
    expect(() => decodeHandoff({ handoff }, true)).toThrow()
    expect(() => decodeHandoff({ handoff, check: { outcome: 'found', attested: false } }, true)).toThrow()
    expect(() => decodeHandoff({ handoff, check: { outcome: 'found', attested: true, alreadyAttested: true } }, true)).toThrow()
    expect(() => decodeHandoff({ handoff, check: { outcome: 'fetch_failed', attested: true, alreadyAttested: false } }, true)).toThrow()
    expect(decodeHandoff({ handoff, check: { outcome: 'found', attested: false, alreadyAttested: true } }, true)).toEqual(handoff)
    // A concurrent/receipt check can be newer than this member's accepted check.
    expect(decodeHandoff({ handoff, check: { outcome: 'missing', attested: false, alreadyAttested: false } }, true)).toEqual(handoff)
  })
  it('uses a closed error vocabulary and does not expose response text', () => {
    expect(handoffResponseError({ error: 'LIVE_CHECK_NOT_OPEN' })).toBe('LIVE_CHECK_NOT_OPEN')
    expect(handoffResponseError({ error: '<script>private data</script>' })).toBe('HANDOFF_UNAVAILABLE')
    expect(handoffResponseError(null)).toBe('HANDOFF_UNAVAILABLE')
  })
})

describe('stored timestamp precision and zone', () => {
  it.each([at, '2026-11-13T17:00:00Z', '2026-11-13T17:00:00.123456789+00:00', '2026-11-14T01:00:00.123456+08:00', '2026-11-13T12:00:00.123456-05:00', '2024-02-29T00:00:00Z'])('accepts an explicit stored zone: %s', value => {
    expect(isHandoffTimestamp(value)).toBe(true)
  })
  it.each(['2026-11-13', '2026-11-13T17:00:00', '2026-11-13T24:00:00Z', '2026-13-01T00:00:00Z', '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-11-13T17:00:00+25:00', 'not-a-time', null])('rejects absent zones or invalid calendar/time values: %s', value => {
    expect(isHandoffTimestamp(value)).toBe(false)
  })
  it('preserves microseconds and distinguishes UTC from an original numeric offset', () => {
    expect(handoffTimestamp(at)).toBe('2026-11-13 17:00:00.123456 UTC')
    expect(handoffTimestamp('2026-11-13T17:00:00.123456+00:00')).toBe('2026-11-13 17:00:00.123456 UTC')
    expect(handoffTimestamp('2026-11-14T01:00:00.123456+08:00')).toBe('2026-11-14 01:00:00.123456+08:00')
    expect(handoffTimestamp('2026-11-13T12:00:00.123456-05:00')).toBe('2026-11-13 12:00:00.123456-05:00')
    expect(handoffTimestamp('2026-11-13T17:00:00-00:00')).not.toContain('UTC')
  })
})

describe('handoff request generations and action authority (pure transitions)', () => {
  it('requires a fresh accepted server read, and revokes authority throughout refresh', () => {
    const initial = initialHandoffReadState()
    expect(handoffCanSend(initial)).toBe(false)
    expect(beginHandoffMutation(initial, 'send')).toBeNull()
    const loaded = ready()
    expect(handoffCanSend(loaded)).toBe(true)
    const refreshing = beginHandoffRead(loaded)!
    expect(handoffCanSend(refreshing.state)).toBe(false)
    expect(beginHandoffMutation(refreshing.state, 'send')).toBeNull()
  })
  it('rejects out-of-order GET success, failure and loading completion', () => {
    const first = beginHandoffRead(ready())!
    const second = beginHandoffRead(first.state)!
    const newest = acceptHandoffRead(second.state, second.token, sent(), true)!.state
    expect(acceptHandoffRead(newest, first.token, view(), true)).toBeNull()
    expect(failHandoffRead(newest, first.token)).toBeNull()
    expect(newest.loading).toBe(false)
    expect(newest.handoff?.state).toBe('sent')
  })
  it('gives a confirmed POST priority over every GET that began before it', () => {
    const oldRead = beginHandoffRead(ready())!
    const newerRead = beginHandoffRead(oldRead.state)!
    const fresh = acceptHandoffRead(newerRead.state, newerRead.token, view(), false)!.state
    const write = beginHandoffMutation(fresh, 'send')!
    const confirmed = acceptHandoffMutation(write.state, write.token, sent())!.state
    expect(acceptHandoffRead(confirmed, oldRead.token, view(), false)).toBeNull()
    expect(failHandoffRead(confirmed, oldRead.token)).toBeNull()
    expect(confirmed.handoff?.state).toBe('sent')
  })
  it('locks duplicate sends/checks synchronously before a React busy render', () => {
    for (const action of ['send', 'check'] as const) {
      const start = beginHandoffMutation(ready(action === 'send' ? view() : sent()), action)!
      expect(start.state.busy).toBe(action)
      expect(beginHandoffMutation(start.state, action)).toBeNull()
      expect(beginHandoffMutation(start.state, action === 'send' ? 'check' : 'send')).toBeNull()
      expect(beginHandoffRead(start.state)).toBeNull()
    }
  })
  it('does not let an older mutation failure/completion unlock or replace a later mutation', () => {
    const first = beginHandoffMutation(ready(), 'send')!
    const failed = failHandoffMutation(first.state, first.token, 'HANDOFF_CONFLICT')!
    const read = beginHandoffRead(failed)!
    const fresh = acceptHandoffRead(read.state, read.token, view({ state: 'failed', jobId, lastEventAt: at }), true)!.state
    const retry = beginHandoffMutation(fresh, 'send')!
    expect(currentHandoffRequest(retry.state, first.token)).toBe(false)
    expect(acceptHandoffMutation(retry.state, first.token, sent())).toBeNull()
    expect(failHandoffMutation(retry.state, first.token, 'HANDOFF_UNAVAILABLE')).toBeNull()
    expect(retry.state.busy).toBe('send')
  })
  it.each(['HANDOFF_UNAVAILABLE', 'HANDOFF_CONFLICT', 'LIVE_CHECK_NOT_OPEN'])('failed/network/malformed writes retain observations but revoke capabilities: %s', error => {
    const before = ready(sent({ receipt: { status: 'completed', completedAt: at }, liveCheck: checked() }))
    const start = beginHandoffMutation(before, 'check')!
    const failed = failHandoffMutation(start.state, start.token, error)!
    expect(failed.handoff).toEqual(before.handoff)
    expect(failed.busy).toBeNull()
    expect(failed.loading).toBe(false)
    expect(failed.authority).toBe(false)
    expect(failed.reconcileRequired).toBe(true)
    expect(handoffCanCheck(failed)).toBe(false)
    expect(handoffPrimaryAction(failed, false)).toBe('refresh')
  })
  it('retains a known failed-write error through automatic GET reconciliation and clears it only on explicit success', () => {
    const start = beginHandoffMutation(ready(sent()), 'check')!
    const failed = failHandoffMutation(start.state, start.token, 'LIVE_CHECK_NOT_OPEN')!
    const automatic = beginHandoffRead(failed)!
    const reconciled = acceptHandoffRead(automatic.state, automatic.token, sent(), false)!.state
    expect(reconciled.error).toBe('LIVE_CHECK_NOT_OPEN')
    expect(reconciled.authority).toBe(true)
    const explicitFailure = beginHandoffRead(reconciled)!
    const stillFailed = failHandoffRead(explicitFailure.state, explicitFailure.token)!
    expect(stillFailed.error).toBe('LIVE_CHECK_NOT_OPEN')
    expect(stillFailed.loading).toBe(false)
    const explicit = beginHandoffRead(stillFailed)!
    expect(acceptHandoffRead(explicit.state, explicit.token, sent(), true)!.state.error).toBeNull()
  })
  it('never authorizes an unknown resend, including when server canSend is true', () => {
    const unknown = view({ state: 'unknown', jobId, lastEventAt: at, canCheck: true, checkBlock: null })
    const start = beginHandoffMutation(ready(), 'send')!
    const outcome = acceptHandoffMutation(start.state, start.token, unknown)!.state
    expect(outcome.authority).toBe(false)
    expect(handoffCanSend(outcome)).toBe(false)
    expect(handoffCanCheck(outcome)).toBe(false)
    expect(handoffPrimaryAction(outcome, false)).toBe('refresh')
    const read = beginHandoffRead(outcome)!
    const fresh = acceptHandoffRead(read.state, read.token, unknown, true)!.state
    expect(handoffCanSend(fresh)).toBe(false)
    expect(beginHandoffMutation(fresh, 'send')).toBeNull()
    expect(handoffCanCheck(fresh)).toBe(true)
    expect(handoffPrimaryAction(fresh, false)).toBe('refresh')
  })
  it('allows intentional retry of a fresh confirmed failed state only with canSend=true', () => {
    const failed = view({ state: 'failed', jobId, lastEventAt: at })
    expect(handoffCanSend(ready(failed))).toBe(true)
    expect(handoffPrimaryAction(ready(failed), false)).toBe('send')
    expect(handoffCanSend(ready({ ...failed, canSend: false, block: 'not_approver' }))).toBe(false)
  })
  it('stops loading after unavailable reads and exposes read recovery without an empty state', () => {
    const read = beginHandoffRead(initialHandoffReadState())!
    const failed = failHandoffRead(read.state, read.token)!
    expect(failed.loading).toBe(false)
    expect(failed.busy).toBeNull()
    expect(failed.handoff).toBeNull()
    expect(failed.error).toBe('HANDOFF_UNAVAILABLE')
    expect(handoffPrimaryAction(failed, false)).toBe('refresh')
  })
  it.each([false, true])('uses actual canCheck for sent/completed/cooldown without inferring permission (completed=%s)', completed => {
    const base = sent({ receipt: completed ? { status: 'completed', completedAt: at } : null })
    expect(handoffCanCheck(ready(base))).toBe(true)
    expect(handoffPrimaryAction(ready(base), false)).toBe('check')
    const cooldown = ready({ ...base, liveCheck: checked(), canCheck: false, checkBlock: 'too_soon' })
    expect(handoffCanCheck(cooldown)).toBe(false)
    expect(handoffCanSend(cooldown)).toBe(false)
    expect(handoffPrimaryAction(cooldown, false)).toBeNull()
  })
  it('makes a repeat check secondary after a match, with removal inversion and no c4/provenance gate', () => {
    for (const structuredData of ['pass', 'warn', 'fail', null] as const) for (const attested of [true, false]) {
      expect(handoffPrimaryAction(ready(sent({ liveCheck: checked({ structuredData, attested }) })), false)).toBeNull()
      expect(handoffPrimaryAction(ready(sent({ liveCheck: checked({ outcome: 'missing', structuredData, attested }) })), true)).toBeNull()
      expect(handoffPrimaryAction(ready(sent({ liveCheck: checked({ outcome: 'missing', structuredData, attested: false }) })), false)).toBe('check')
    }
  })
})

describe('recorded-change invalidation contract', () => {
  it('keeps an initial read with no recorded observations silent', () => {
    const read = beginHandoffRead(initialHandoffReadState())!
    expect(acceptHandoffRead(read.state, read.token, view(), false)?.recordedChange).toBe(false)
  })
  it.each([
    sent({ receipt: { status: 'completed', completedAt: at } }),
    sent({ liveCheck: checked() }),
    sent({ receipt: { status: 'completed', completedAt: at }, liveCheck: checked() }),
  ])('refreshes existing recorded observations on the first accepted read once %#', handoff => {
    const read = beginHandoffRead(initialHandoffReadState())!
    const accepted = acceptHandoffRead(read.state, read.token, handoff, false)!
    expect(accepted.recordedChange).toBe(true)
    const repeat = beginHandoffRead(accepted.state)!
    expect(acceptHandoffRead(repeat.state, repeat.token, handoff, false)?.recordedChange).toBe(false)
  })
  it('notifies only on changed receipt/check observations after baseline, never identical/capability-only reads', () => {
    let state = ready(sent())
    const changed = sent({ receipt: { status: 'completed', completedAt: at }, liveCheck: checked() })
    const read = beginHandoffRead(state)!
    const result = acceptHandoffRead(read.state, read.token, changed, true)!
    expect(result.recordedChange).toBe(true)
    state = result.state
    for (const handoff of [changed, { ...changed, canCheck: false, checkBlock: 'too_soon' as const }, { ...changed, executorRef: 'new reference' }]) {
      const next = beginHandoffRead(state)!
      const result = acceptHandoffRead(next.state, next.token, handoff, false)!
      expect(result.recordedChange).toBe(false)
      state = result.state
    }
    const changedCheck = beginHandoffRead(state)!
    expect(acceptHandoffRead(changedCheck.state, changedCheck.token, { ...changed, liveCheck: checked({ checkedAt: '2026-11-13T17:02:00.123456Z' }) }, true)?.recordedChange).toBe(true)
  })
  it('notifies for a changed check attestation/observation, including its removal', () => {
    let state = ready(sent({ liveCheck: checked() }))
    for (const liveCheck of [checked({ attested: true }), checked({ structuredData: 'warn' }), null]) {
      const start = beginHandoffRead(state)!
      const result = acceptHandoffRead(start.state, start.token, sent({ liveCheck }), false)!
      expect(result.recordedChange).toBe(true)
      state = result.state
    }
  })
  it('notifies once for an accepted member check even if the latest stored observation is unchanged', () => {
    const start = beginHandoffMutation(ready(sent({ liveCheck: checked() })), 'check')!
    const result = acceptHandoffMutation(start.state, start.token, sent({ liveCheck: checked() }))!
    expect(result.recordedChange).toBe(true)
    expect(acceptHandoffMutation(result.state, start.token, sent({ liveCheck: checked() }))).toBeNull()
    const read = beginHandoffRead(result.state)!
    expect(acceptHandoffRead(read.state, read.token, sent({ liveCheck: checked() }), false)?.recordedChange).toBe(false)
  })
  it('does not notify for a send that only changes transport state, or any rejected stale completion', () => {
    const start = beginHandoffMutation(ready(), 'send')!
    expect(acceptHandoffMutation(start.state, start.token, sent())?.recordedChange).toBe(false)
    const failed = failHandoffMutation(start.state, start.token, 'HANDOFF_UNAVAILABLE')!
    const read = beginHandoffRead(failed)!
    expect(acceptHandoffMutation(read.state, start.token, sent({ liveCheck: checked() }))).toBeNull()
  })
})
