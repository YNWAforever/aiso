import { describe, expect, it } from 'vitest'
import { handoffRecovery } from '@/lib/site-edit/handoff-guidance'
import { handoffCanCheck, handoffCanSend, initialHandoffReadState, type HandoffReadState, type HandoffReadView } from '@/lib/site-edit/handoff-read-view'

function ready(overrides: Partial<HandoffReadView> = {}, state: Partial<HandoffReadState> = {}): HandoffReadState {
  return { ...initialHandoffReadState(), authority: true, loading: false, handoff: {
    state: 'none', jobId: null, executorRef: null, lastEventAt: null, canSend: false, block: 'not_connected',
    receipt: null, liveCheck: null, canCheck: false, checkBlock: 'not_open', ...overrides,
  }, ...state }
}

describe('handoff recovery navigation does not establish action authority', () => {
  it.each(['not_connected', 'limit_reached'] as const)('offers viewing manual options for an authoritative %s block', block => {
    const state = ready({ block })
    expect(handoffRecovery(state)).toBe('manual')
    expect(handoffCanSend(state)).toBe(false)
  })
  it('offers the existing plan view for a confirmed entitlement block', () => {
    expect(handoffRecovery(ready({ block: 'not_entitled' }))).toBe('plan')
  })
  it.each(['not_approved', 'superseded', 'no_edit_spec', 'not_approver', 'in_flight', 'already_sent', null] as const)('does not invent an account-role or manual remedy for %s', block => {
    expect(handoffRecovery(ready({ block }))).toBeNull()
  })
  it.each<Partial<HandoffReadState>>([
    { authority: false }, { loading: true }, { busy: 'send' }, { busy: 'check' }, { reconcileRequired: true }, { handoff: null },
  ])('hides preserved recovery advice when the latest state lacks authority: %#', patch => {
    expect(handoffRecovery(ready({}, patch))).toBeNull()
  })
  it.each(['sending', 'sent', 'unknown'] as const)('does not suggest a manual fallback during %s', state => {
    expect(handoffRecovery(ready({ state }))).toBeNull()
  })
  it('does not suggest recovery from an inconsistent send capability or an existing receipt', () => {
    expect(handoffRecovery(ready({ canSend: true }))).toBeNull()
    expect(handoffRecovery(ready({ receipt: { status: 'completed', completedAt: '2026-11-14T04:00:00Z' } }))).toBeNull()
  })
  it('leaves the separately gated check action intact for an authoritative unknown job', () => {
    const state = ready({ state: 'unknown', jobId: '123e4567-e89b-42d3-a456-426614174000', canSend: true, block: null, canCheck: true, checkBlock: null })
    expect(handoffRecovery(state)).toBeNull()
    expect(handoffCanSend(state)).toBe(false)
    expect(handoffCanCheck(state)).toBe(true)
  })
})
