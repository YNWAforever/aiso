/** Browser-only read model: no server, database, crypto or network imports. */
export type HandoffReadView = {
  state: 'none' | 'sending' | 'sent' | 'failed' | 'unknown'
  jobId: string | null
  executorRef: string | null
  lastEventAt: string | null
  canSend: boolean
  block: 'not_approved' | 'superseded' | 'no_edit_spec' | 'not_approver' | 'not_entitled' | 'limit_reached' | 'not_connected' | 'in_flight' | 'already_sent' | null
  receipt: { status: 'completed' | 'rejected'; completedAt: string } | null
  liveCheck: { outcome: 'found' | 'missing' | 'fetch_failed'; checkedAt: string; attested: boolean; structuredData: 'pass' | 'warn' | 'fail' | null } | null
  canCheck: boolean
  checkBlock: 'not_open' | 'too_soon' | null
}
const STATES = ['none', 'sending', 'sent', 'failed', 'unknown']
const BLOCKS = [null, 'not_approved', 'superseded', 'no_edit_spec', 'not_approver', 'not_entitled', 'limit_reached', 'not_connected', 'in_flight', 'already_sent']
const CHECK_BLOCKS = [null, 'not_open', 'too_soon']
const OUTCOMES = ['found', 'missing', 'fetch_failed']
const ERRORS = ['HANDOFF_NOT_APPROVER', 'HANDOFF_LIMIT_REACHED', 'HANDOFF_UPGRADE_REQUIRED', 'LIVE_CHECK_NOT_OPEN', 'LIVE_CHECK_TOO_SOON', 'HANDOFF_NOT_APPROVED', 'HANDOFF_SUPERSEDED', 'HANDOFF_NO_EDIT_SPEC', 'HANDOFF_DOMAIN_UNVERIFIED', 'HANDOFF_CONFLICT', 'HANDOFF_IN_FLIGHT', 'HANDOFF_NOT_CONNECTED', 'HANDOFF_UNAVAILABLE']
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Require a real timestamp with an explicit zone; retain the wire precision/offset. */
export function isHandoffTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return false
  const monthEnd = new Date(value.substring(0, 7) + '-01T00:00:00Z')
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)
  monthEnd.setUTCDate(0)
  return Number(value.substring(8, 10)) <= monthEnd.getUTCDate()
}

export function handoffTimestamp(value: string): string {
  // Do not round through Date/toISOString: stored checks retain microseconds.
  if (value.endsWith('Z')) return value.substring(0, value.length - 1).replace('T', ' ') + ' UTC'
  if (value.endsWith('+00:00')) return value.substring(0, value.length - 6).replace('T', ' ') + ' UTC'
  return value.replace('T', ' ')
}

export function decodeHandoff(value: unknown, acceptedCheck = false): HandoffReadView {
  if (!record(value) || !record(value.handoff)) throw Error('Invalid handoff')
  const h = value.handoff
  if (!STATES.includes(h.state as string) || !BLOCKS.includes(h.block as string | null)
    || typeof h.canSend !== 'boolean' || h.canSend !== (h.block === null)
    || !CHECK_BLOCKS.includes(h.checkBlock as string | null) || typeof h.canCheck !== 'boolean' || h.canCheck !== (h.checkBlock === null)
    || (h.jobId !== null && (typeof h.jobId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(h.jobId)))
    || (h.executorRef !== null && (typeof h.executorRef !== 'string' || h.executorRef.length < 1 || h.executorRef.length > 200 || /[\u0000-\u001f]/.test(h.executorRef)))
    || (h.lastEventAt !== null && !isHandoffTimestamp(h.lastEventAt))) throw Error('Invalid handoff')
  const r = h.receipt, c = h.liveCheck
  if (r !== null && (!record(r) || !['completed', 'rejected'].includes(r.status as string) || !isHandoffTimestamp(r.completedAt))) throw Error('Invalid receipt')
  if (c !== null && (!record(c) || !OUTCOMES.includes(c.outcome as string) || !isHandoffTimestamp(c.checkedAt)
    || typeof c.attested !== 'boolean' || ![null, 'pass', 'warn', 'fail'].includes(c.structuredData as string | null)
    || (c.outcome === 'fetch_failed' && (c.attested || c.structuredData !== null)))) throw Error('Invalid check')
  if (h.jobId === null && (r !== null || c !== null || h.canCheck)) throw Error('Invalid job')
  if (acceptedCheck) {
    const check = value.check
    if (!record(check) || !OUTCOMES.includes(check.outcome as string) || typeof check.attested !== 'boolean'
      || typeof check.alreadyAttested !== 'boolean' || (check.attested && (check.alreadyAttested || check.outcome === 'fetch_failed')) || c === null) throw Error('Invalid accepted check')
  }
  // Copy only validated public fields, independent of response property order.
  return {
    state: h.state as HandoffReadView['state'], jobId: h.jobId as string | null, executorRef: h.executorRef as string | null,
    lastEventAt: h.lastEventAt as string | null, canSend: h.canSend, block: h.block as HandoffReadView['block'],
    receipt: r === null ? null : { status: r.status, completedAt: r.completedAt } as HandoffReadView['receipt'],
    liveCheck: c === null ? null : { outcome: c.outcome, checkedAt: c.checkedAt, attested: c.attested, structuredData: c.structuredData } as HandoffReadView['liveCheck'],
    canCheck: h.canCheck, checkBlock: h.checkBlock as HandoffReadView['checkBlock'],
  }
}

export function handoffResponseError(value: unknown): string {
  return record(value) && typeof value.error === 'string' && ERRORS.includes(value.error) ? value.error : 'HANDOFF_UNAVAILABLE'
}

export type HandoffAction = 'send' | 'check'
export type HandoffReadState = {
  handoff: HandoffReadView | null
  authority: boolean
  loading: boolean
  busy: HandoffAction | null
  error: string | null
  reconcileRequired: boolean
  readGeneration: number
  mutationGeneration: number
  observationKey: string | null
}
export type HandoffRequestToken = Pick<HandoffReadState, 'readGeneration' | 'mutationGeneration'>
export const initialHandoffReadState = (): HandoffReadState => ({ handoff: null, authority: false, loading: true, busy: null, error: null, reconcileRequired: false, readGeneration: 0, mutationGeneration: 0, observationKey: null })
const tokenFor = ({ readGeneration, mutationGeneration }: HandoffReadState): HandoffRequestToken => ({ readGeneration, mutationGeneration })
export const currentHandoffRequest = (state: HandoffReadState, token: HandoffRequestToken) => state.readGeneration === token.readGeneration && state.mutationGeneration === token.mutationGeneration
const observations = (h: HandoffReadView) => JSON.stringify([h.receipt?.status ?? null, h.receipt?.completedAt ?? null, h.liveCheck?.outcome ?? null, h.liveCheck?.checkedAt ?? null, h.liveCheck?.attested ?? null, h.liveCheck?.structuredData ?? null])

export function handoffCanSend(state: HandoffReadState): boolean {
  const h = state.handoff
  // Unknown is never resend authority, even when the server permits a retry.
  return state.authority && !state.loading && !state.busy && Boolean(h?.canSend && !h.receipt && (h.state === 'none' || h.state === 'failed'))
}
export const handoffCanCheck = (state: HandoffReadState): boolean => state.authority && !state.loading && !state.busy && Boolean(state.handoff?.canCheck)

export function beginHandoffRead(state: HandoffReadState) {
  if (state.busy) return null
  const next = { ...state, readGeneration: state.readGeneration + 1, loading: true, authority: false }
  return { state: next, token: tokenFor(next) }
}
export function acceptHandoffRead(state: HandoffReadState, token: HandoffRequestToken, handoff: HandoffReadView, explicit: boolean) {
  if (!currentHandoffRequest(state, token) || state.busy) return null
  const observationKey = observations(handoff)
  return {
    state: { ...state, handoff, loading: false, authority: true, reconcileRequired: false, error: explicit ? null : state.error, observationKey },
    recordedChange: state.observationKey === null ? Boolean(handoff.receipt || handoff.liveCheck) : state.observationKey !== observationKey,
  }
}
export function failHandoffRead(state: HandoffReadState, token: HandoffRequestToken): HandoffReadState | null {
  return currentHandoffRequest(state, token) && !state.busy ? { ...state, loading: false, authority: false, reconcileRequired: true, error: state.error ?? 'HANDOFF_UNAVAILABLE' } : null
}
export function beginHandoffMutation(state: HandoffReadState, action: HandoffAction) {
  if (!(action === 'send' ? handoffCanSend(state) : handoffCanCheck(state))) return null
  // Updating this state in a ref before fetch is the synchronous duplicate lock.
  const next: HandoffReadState = { ...state, readGeneration: state.readGeneration + 1, mutationGeneration: state.mutationGeneration + 1, busy: action, loading: false, authority: false, error: null }
  return { state: next, token: tokenFor(next) }
}
export function acceptHandoffMutation(state: HandoffReadState, token: HandoffRequestToken, handoff: HandoffReadView) {
  if (!currentHandoffRequest(state, token) || !state.busy) return null
  const observationKey = observations(handoff)
  return {
    state: { ...state, handoff, busy: null, authority: handoff.state !== 'unknown', reconcileRequired: handoff.state === 'unknown', error: null, observationKey },
    // An accepted check is a stored write even when a concurrent check is the latest read.
    recordedChange: state.busy === 'check' || (state.observationKey !== null && state.observationKey !== observationKey),
  }
}
export function failHandoffMutation(state: HandoffReadState, token: HandoffRequestToken, error: string): HandoffReadState | null {
  return currentHandoffRequest(state, token) && state.busy ? { ...state, busy: null, authority: false, loading: false, reconcileRequired: true, error } : null
}

export function handoffPrimaryAction(state: HandoffReadState, removal: boolean): HandoffAction | 'refresh' | null {
  if (state.reconcileRequired || state.handoff?.state === 'unknown' || (!state.handoff && !state.loading)) return 'refresh'
  const check = state.handoff?.liveCheck
  const matched = check && check.outcome === (removal ? 'missing' : 'found')
  if (handoffCanCheck(state) && !matched) return 'check'
  if (handoffCanSend(state)) return 'send'
  return null
}
