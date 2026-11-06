import 'server-only'
import { getProfile } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { readLimitedJson } from '@/lib/approvals/request'
import { appOrigin } from '@/lib/app-origin'
import { deliveryId } from '@/lib/delivery/input'
import { checkEditSpecDomainPinned } from './domain'
import {
  HANDOFF_DEADLINE_MS, HANDOFF_STALE_MS, SITE_EDIT_MONTHLY_SENDS_PER_BRAND, executorRef, handoffBody, handoffConfig, handoffSignature, handoffState, outcomeFor,
  type HandoffEvent, type HandoffOutcome, type HandoffState,
} from './handoff'
import { claimHandoff, readHandoff, recordHandoffOutcome, type HandoffScope, type LiveCheckView } from './handoff-store'
import { LIVE_CHECK_SPACING_MS, fetchLivePage } from './live-check'
import { loadAutoCheckScope, recordLiveCheck, type LiveCheckTrigger } from './live-check-store'

/**
 * Site-edit S2: send one approved edit spec to the executor (brief §3, §3a).
 *
 * Gate, in order: session → ids → membership + ownership (in SQL) → approved
 * LATEST version whose hash the caller names → edit spec present → target
 * still on the brand's verified domain → executor configured. Then exactly
 * one outbound attempt with a 10 s deadline and no automatic retry, bracketed
 * by an insert-only claim and outcome. A 2xx from this route always means the
 * outcome row was written; a lost outcome write is a 503 and reads "unknown".
 */

const headers = { 'Cache-Control': 'no-store' }
const statuses = {
  HANDOFF_UNAUTHENTICATED: 401,
  HANDOFF_INVALID_INPUT: 400,
  HANDOFF_DENIED: 403,
  HANDOFF_NOT_FOUND: 404,
  HANDOFF_UPGRADE_REQUIRED: 403,
  HANDOFF_NOT_APPROVER: 403,
  HANDOFF_LIMIT_REACHED: 429,
  HANDOFF_NOT_APPROVED: 409,
  HANDOFF_SUPERSEDED: 409,
  HANDOFF_NO_EDIT_SPEC: 409,
  HANDOFF_DOMAIN_UNVERIFIED: 409,
  HANDOFF_CONFLICT: 409,
  HANDOFF_IN_FLIGHT: 409,
  HANDOFF_NOT_CONNECTED: 409,
  LIVE_CHECK_NOT_OPEN: 409,
  LIVE_CHECK_TOO_SOON: 429,
  HANDOFF_UNAVAILABLE: 503,
} as const
type Code = keyof typeof statuses
class HandoffError extends Error { constructor(readonly code: Code) { super(code) } }

const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
function errorResponse(error: unknown): Response {
  if (error instanceof HandoffError) return json({ error: error.code }, statuses[error.code])
  console.error('[site-edit] hand-off failed', { name: error instanceof Error ? error.name : typeof error })
  return json({ error: 'HANDOFF_UNAVAILABLE' }, 503)
}

export type HandoffBlock = 'not_approved' | 'superseded' | 'no_edit_spec' | 'not_approver' | 'not_entitled' | 'limit_reached' | 'not_connected' | 'in_flight' | 'already_sent' | null
export type HandoffView = {
  state: HandoffState
  jobId: string | null
  executorRef: string | null
  lastEventAt: string | null
  canSend: boolean
  block: HandoffBlock
  /** S3: what the executor reported. A claim, never verification (that is S4). */
  receipt: { status: 'completed' | 'rejected'; completedAt: string } | null
  /** S4: the newest live-page check, and whether a new one may run now. */
  liveCheck: LiveCheckView | null
  canCheck: boolean
  checkBlock: 'not_open' | 'too_soon' | null
}

function view(read: Extract<Awaited<ReturnType<typeof readHandoff>>, { kind: 'ok' }>, connected: boolean, now: Date, entitled = true, actorId?: string): HandoffView {
  const state = handoffState(read.events, now)
  const latest = [...read.events].sort((a, b) => b.seq - a.seq)[0] as HandoffEvent | undefined
  const sent = [...read.events].reverse().find(e => e.kind === 'sent')
  const block: HandoffBlock = read.version.decision?.decision !== 'approved' ? 'not_approved'
    : read.latestId !== read.version.id ? 'superseded'
    : !read.version.editSpec ? 'no_edit_spec'
    : state === 'sent' || read.receipt ? 'already_sent'
    : state === 'sending' ? 'in_flight'
    // S11 (Q5): only the member who approved this version may send it. Enforced again inside the claim.
    : actorId !== undefined && read.version.decision?.decidedBy?.profileId !== actorId ? 'not_approver'
    // S8 (Q6): sending is a Pro/Enterprise feature. A job already sent keeps its receipt and live checks.
    : !entitled ? 'not_entitled'
    // S8 cap: 10 sends per brand per Hong Kong calendar month; re-sending a job already counted is free.
    : !read.monthSends.selfCounted && read.monthSends.others >= SITE_EDIT_MONTHLY_SENDS_PER_BRAND ? 'limit_reached'
    : !connected ? 'not_connected'
    : null
  const open = read.job !== null && read.receipt?.status !== 'rejected' && (read.receipt?.status === 'completed' || state === 'sent' || state === 'unknown')
  const checkable = open && read.version.decision?.decision === 'approved' && read.latestId === read.version.id && Boolean(read.version.editSpec)
  const rested = !read.liveCheck || now.getTime() - Date.parse(read.liveCheck.checkedAt) >= LIVE_CHECK_SPACING_MS
  return { state, jobId: read.job?.id ?? null, executorRef: sent?.executorRef ?? null, lastEventAt: latest?.at ?? null, canSend: block === null, block,
    receipt: read.receipt, liveCheck: read.liveCheck, canCheck: checkable && rested, checkBlock: !checkable ? 'not_open' : !rested ? 'too_soon' : null }
}

async function sessionScope(clientId: string, itemId: string, versionId: string): Promise<{ scope: HandoffScope; entitled: boolean }> {
  // Outside any catch that would flatten it: a session-store outage is not "signed out".
  const profile = await getProfile()
  if (!profile) throw new HandoffError('HANDOFF_UNAUTHENTICATED')
  // resolveCommercialEntitlement fails closed to free (override → past_due → cancelled → trial → paid).
  const entitled = resolveCommercialEntitlement(profile.accounts).features.site_edit === true
  try {
    return { entitled, scope: { clientId: deliveryId(clientId), itemId: deliveryId(itemId), versionId: deliveryId(versionId),
      accountId: deliveryId(profile.account_id), actorId: deliveryId(profile.id) } }
  } catch { throw new HandoffError('HANDOFF_NOT_FOUND') }
}
const scopeFor = async (clientId: string, itemId: string, versionId: string) => (await sessionScope(clientId, itemId, versionId)).scope

async function load(scope: HandoffScope) {
  const read = await readHandoff(scope)
  if (read.kind === 'denied') throw new HandoffError('HANDOFF_DENIED')
  if (read.kind === 'not_found') throw new HandoffError('HANDOFF_NOT_FOUND')
  if (read.kind === 'invalid') throw new HandoffError('HANDOFF_UNAVAILABLE')
  return read
}

export async function readAuthenticatedHandoff(clientId: string, itemId: string, versionId: string): Promise<Response> {
  try {
    const { scope, entitled } = await sessionScope(clientId, itemId, versionId)
    const read = await load(scope)
    return json({ handoff: view(read, handoffConfig() !== null, new Date(), entitled, scope.actorId) })
  } catch (error) { return errorResponse(error) }
}

function readHash(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).join() !== 'contentHash'
    || typeof (raw as { contentHash: unknown }).contentHash !== 'string'
    || !/^[0-9a-f]{64}$/.test((raw as { contentHash: string }).contentHash)) throw new HandoffError('HANDOFF_INVALID_INPUT')
  return (raw as { contentHash: string }).contentHash
}

/**
 * Site-edit S4: fetch the frozen target URL once and record what was there.
 * Gate: session → ids → membership + ownership (SQL) → hash → the job is open
 * (handed off, or reported completed, and not declined) → target still on the
 * brand's verified domain → spacing. Every check is recorded; only "found"
 * also records a verified C9e attestation, and only when none is active. A
 * 2xx always means the check row was written.
 */
export async function checkAuthenticatedLivePage(clientId: string, itemId: string, versionId: string, request: Request): Promise<Response> {
  try {
    const scope = await scopeFor(clientId, itemId, versionId)
    let raw: unknown
    try { raw = await readLimitedJson(request, 1024) } catch { throw new HandoffError('HANDOFF_INVALID_INPUT') }
    const contentHash = readHash(raw)
    const read = await load(scope)
    if (read.version.contentHash !== contentHash) throw new HandoffError('HANDOFF_CONFLICT')
    const current = view(read, handoffConfig() !== null, new Date(), true, scope.actorId)
    if (current.checkBlock) throw new HandoffError(current.checkBlock === 'too_soon' ? 'LIVE_CHECK_TOO_SOON' : 'LIVE_CHECK_NOT_OPEN')
    const written = await runLiveCheck(scope, read, 'member')
    if (written.kind === 'denied') throw new HandoffError('HANDOFF_DENIED')
    if (written.kind === 'not_found') throw new HandoffError('HANDOFF_NOT_FOUND')
    if (written.kind === 'ineligible') throw new HandoffError('LIVE_CHECK_NOT_OPEN')
    const after = await load(scope)
    return json({ handoff: view(after, handoffConfig() !== null, new Date(), true, scope.actorId),
      check: { outcome: written.outcome, attested: written.attested, alreadyAttested: written.alreadyAttested } }, 201)
  } catch (error) { return errorResponse(error) }
}

/** The shared tail of a live check, once the caller has established the job is open: domain, one fetch, one write. */
async function runLiveCheck(scope: HandoffScope, read: Extract<Awaited<ReturnType<typeof readHandoff>>, { kind: 'ok' }>, trigger: LiveCheckTrigger) {
  const spec = read.version.editSpec!
  const domain = await checkEditSpecDomainPinned(scope.accountId, scope.clientId, spec)
  if (domain.result !== 'ok') throw new HandoffError('HANDOFF_DOMAIN_UNVERIFIED')
  const fetched = await fetchLivePage(spec.targetUrl, spec)
  return recordLiveCheck(scope, read.version.contentHash, { ...fetched, targetUrl: spec.targetUrl, kind: spec.kind, trigger })
}

/**
 * Site-edit S6: run the live check once, automatically, right after the
 * executor's "completed" receipt is recorded, so a verified delivery does not
 * wait for somebody to press the button. It runs after the receipt response
 * (Next `after`), as the member who sent the hand-off, under exactly the gates
 * a member's check passes (still a member, latest approved version, open job,
 * verified domain, one-minute spacing) and is best-effort: any refusal or
 * failure is logged by name only and leaves the button for a person to press.
 */
export async function autoCheckAfterReceipt(jobId: string, accountId: string): Promise<void> {
  try {
    const scope = await loadAutoCheckScope(jobId, accountId)
    if (!scope) return
    const read = await readHandoff(scope)
    if (read.kind !== 'ok' || read.job?.id !== jobId) return
    if (view(read, handoffConfig() !== null, new Date()).checkBlock) return
    await runLiveCheck(scope, read, 'receipt')
  } catch (error) {
    console.error('[site-edit] automatic live check skipped', { name: error instanceof Error ? error.name : typeof error,
      code: error instanceof HandoffError ? error.code : undefined })
  }
}

async function callExecutor(url: string, secret: string, body: string, jobId: string): Promise<HandoffOutcome> {
  const timestamp = Math.floor(Date.now() / 1000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(HANDOFF_DEADLINE_MS),
      headers: {
        'Content-Type': 'application/json',
        'X-AISO-Timestamp': String(timestamp),
        'X-AISO-Signature': handoffSignature(secret, timestamp, body),
        'X-AISO-Job-Id': jobId,
      },
      body,
    })
    const parsed = await response.json().catch(() => null)
    return outcomeFor(response.status, executorRef(parsed))
  } catch {
    // Timeout, DNS, TLS, reset: the executor may or may not have the job.
    return { kind: 'unknown' }
  }
}

export async function sendAuthenticatedHandoff(clientId: string, itemId: string, versionId: string, request: Request): Promise<Response> {
  try {
    const { scope, entitled } = await sessionScope(clientId, itemId, versionId)
    let raw: unknown
    try { raw = await readLimitedJson(request, 1024) } catch { throw new HandoffError('HANDOFF_INVALID_INPUT') }
    const contentHash = readHash(raw)

    const read = await load(scope)
    const config = handoffConfig()
    const current = view(read, config !== null, new Date(), entitled, scope.actorId)
    // Already accepted: return the existing job, make no call (one hand-off per version).
    if (current.block === 'already_sent') return json({ handoff: current })
    if (read.version.contentHash !== contentHash) throw new HandoffError('HANDOFF_CONFLICT')
    const blocks: Record<Exclude<HandoffBlock, null | 'already_sent'>, Code> = {
      not_approved: 'HANDOFF_NOT_APPROVED', superseded: 'HANDOFF_SUPERSEDED', no_edit_spec: 'HANDOFF_NO_EDIT_SPEC',
      in_flight: 'HANDOFF_IN_FLIGHT', not_entitled: 'HANDOFF_UPGRADE_REQUIRED', limit_reached: 'HANDOFF_LIMIT_REACHED',
      not_connected: 'HANDOFF_NOT_CONNECTED', not_approver: 'HANDOFF_NOT_APPROVER',
    }
    if (current.block) throw new HandoffError(blocks[current.block])
    const spec = read.version.editSpec!
    // Re-checked at send time, and PINNED: the claim statement requires the
    // brand's domain and verification to still equal what this check saw, so
    // a repoint in between refuses the send instead of mislabelling it.
    const domain = await checkEditSpecDomainPinned(scope.accountId, scope.clientId, spec)
    if (domain.result !== 'ok' || !domain.pin) throw new HandoffError('HANDOFF_DOMAIN_UNVERIFIED')

    const claim = await claimHandoff(scope, contentHash, new Date(Date.now() - HANDOFF_STALE_MS), domain.pin)
    if (claim.kind === 'busy') throw new HandoffError('HANDOFF_IN_FLIGHT')
    if (claim.kind === 'ineligible') throw new HandoffError('HANDOFF_CONFLICT')
    if (claim.kind === 'capped') throw new HandoffError('HANDOFF_LIMIT_REACHED')

    const body = handoffBody({
      jobId: claim.jobId, versionId: scope.versionId, contentHash,
      client: { id: scope.clientId, name: read.clientName, verifiedDomain: domain.pin.verifiedDomain },
      editSpec: spec, approvedAt: read.version.decision!.decidedAt,
      receiptUrl: `${appOrigin()}/api/site-edit/receipts`,
    })
    const outcome = await callExecutor(config!.url, config!.secret, body, claim.jobId)
    try {
      await recordHandoffOutcome({
        accountId: scope.accountId, jobId: claim.jobId, claimSeq: claim.seq, actorId: scope.actorId, kind: outcome.kind,
        status: outcome.kind === 'unknown' ? null : outcome.status, ref: outcome.kind === 'sent' ? outcome.ref : null,
      })
    } catch (error) {
      // The call happened but its outcome is not on record: never a 2xx. The stale claim reads "unknown".
      console.error('[site-edit] outcome not recorded', { job: claim.jobId, outcome: outcome.kind, name: error instanceof Error ? error.name : typeof error })
      return json({ error: 'HANDOFF_UNAVAILABLE' }, 503)
    }
    const after = await load(scope)
    return json({ handoff: view(after, true, new Date(), true, scope.actorId) }, outcome.kind === 'sent' ? 201 : 200)
  } catch (error) { return errorResponse(error) }
}
