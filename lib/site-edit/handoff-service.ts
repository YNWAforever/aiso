import 'server-only'
import { getProfile } from '@/lib/auth'
import { readLimitedJson } from '@/lib/approvals/request'
import { appOrigin } from '@/lib/app-origin'
import { deliveryId } from '@/lib/delivery/input'
import { checkEditSpecDomainPinned } from './domain'
import {
  HANDOFF_DEADLINE_MS, HANDOFF_STALE_MS, executorRef, handoffBody, handoffConfig, handoffSignature, handoffState, outcomeFor,
  type HandoffEvent, type HandoffOutcome, type HandoffState,
} from './handoff'
import { claimHandoff, readHandoff, recordHandoffOutcome, type HandoffScope } from './handoff-store'

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
  HANDOFF_NOT_APPROVED: 409,
  HANDOFF_SUPERSEDED: 409,
  HANDOFF_NO_EDIT_SPEC: 409,
  HANDOFF_DOMAIN_UNVERIFIED: 409,
  HANDOFF_CONFLICT: 409,
  HANDOFF_IN_FLIGHT: 409,
  HANDOFF_NOT_CONNECTED: 409,
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

export type HandoffBlock = 'not_approved' | 'superseded' | 'no_edit_spec' | 'not_connected' | 'in_flight' | 'already_sent' | null
export type HandoffView = {
  state: HandoffState
  jobId: string | null
  executorRef: string | null
  lastEventAt: string | null
  canSend: boolean
  block: HandoffBlock
  /** S3: what the executor reported. A claim, never verification (that is S4). */
  receipt: { status: 'completed' | 'rejected'; completedAt: string } | null
}

function view(read: Extract<Awaited<ReturnType<typeof readHandoff>>, { kind: 'ok' }>, connected: boolean, now: Date): HandoffView {
  const state = handoffState(read.events, now)
  const latest = [...read.events].sort((a, b) => b.seq - a.seq)[0] as HandoffEvent | undefined
  const sent = [...read.events].reverse().find(e => e.kind === 'sent')
  const block: HandoffBlock = read.version.decision?.decision !== 'approved' ? 'not_approved'
    : read.latestId !== read.version.id ? 'superseded'
    : !read.version.editSpec ? 'no_edit_spec'
    : state === 'sent' || read.receipt ? 'already_sent'
    : state === 'sending' ? 'in_flight'
    : !connected ? 'not_connected'
    : null
  return { state, jobId: read.job?.id ?? null, executorRef: sent?.executorRef ?? null, lastEventAt: latest?.at ?? null, canSend: block === null, block, receipt: read.receipt }
}

async function scopeFor(clientId: string, itemId: string, versionId: string): Promise<HandoffScope> {
  // Outside any catch that would flatten it: a session-store outage is not "signed out".
  const profile = await getProfile()
  if (!profile) throw new HandoffError('HANDOFF_UNAUTHENTICATED')
  try {
    return { clientId: deliveryId(clientId), itemId: deliveryId(itemId), versionId: deliveryId(versionId),
      accountId: deliveryId(profile.account_id), actorId: deliveryId(profile.id) }
  } catch { throw new HandoffError('HANDOFF_NOT_FOUND') }
}

async function load(scope: HandoffScope) {
  const read = await readHandoff(scope)
  if (read.kind === 'denied') throw new HandoffError('HANDOFF_DENIED')
  if (read.kind === 'not_found') throw new HandoffError('HANDOFF_NOT_FOUND')
  if (read.kind === 'invalid') throw new HandoffError('HANDOFF_UNAVAILABLE')
  return read
}

export async function readAuthenticatedHandoff(clientId: string, itemId: string, versionId: string): Promise<Response> {
  try {
    const scope = await scopeFor(clientId, itemId, versionId)
    const read = await load(scope)
    return json({ handoff: view(read, handoffConfig() !== null, new Date()) })
  } catch (error) { return errorResponse(error) }
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
    const scope = await scopeFor(clientId, itemId, versionId)
    let raw: unknown
    try { raw = await readLimitedJson(request, 1024) } catch { throw new HandoffError('HANDOFF_INVALID_INPUT') }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).join() !== 'contentHash'
      || typeof (raw as { contentHash: unknown }).contentHash !== 'string'
      || !/^[0-9a-f]{64}$/.test((raw as { contentHash: string }).contentHash)) throw new HandoffError('HANDOFF_INVALID_INPUT')
    const contentHash = (raw as { contentHash: string }).contentHash

    const read = await load(scope)
    const config = handoffConfig()
    const current = view(read, config !== null, new Date())
    // Already accepted: return the existing job, make no call (one hand-off per version).
    if (current.block === 'already_sent') return json({ handoff: current })
    if (read.version.contentHash !== contentHash) throw new HandoffError('HANDOFF_CONFLICT')
    const blocks: Record<Exclude<HandoffBlock, null | 'already_sent'>, Code> = {
      not_approved: 'HANDOFF_NOT_APPROVED', superseded: 'HANDOFF_SUPERSEDED', no_edit_spec: 'HANDOFF_NO_EDIT_SPEC',
      in_flight: 'HANDOFF_IN_FLIGHT', not_connected: 'HANDOFF_NOT_CONNECTED',
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
    return json({ handoff: view(after, true, new Date()) }, outcome.kind === 'sent' ? 201 : 200)
  } catch (error) { return errorResponse(error) }
}
