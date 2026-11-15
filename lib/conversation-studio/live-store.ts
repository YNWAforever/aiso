import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { StudioBrandAccess } from './threads'
import type { StudioLiveReply } from './live-types'
import { parseStudioReceipts } from './receipts'

/** Stored only in the existing bounded live JSON column; never a browser capability. */
export type StudioAnswerEnvelope = {
  origin: 'studio-server.v1'
  signature: string
  token: string
  state: 'pending' | 'complete' | 'failed' | 'unknown'
  startedAt: string
  response?: StudioLiveReply
  error?: string
  status?: number
}
export type OwnedAnswerTurn = { id: string; prompt: string; live: unknown; savedContext: string | null }
export const ANSWER_PENDING = 'STUDIO_ANSWER_PENDING'
export const ANSWER_UNKNOWN = 'STUDIO_ANSWER_UNKNOWN'
export const ANSWER_CONFLICT = 'STUDIO_ANSWER_CONFLICT'

export function answerSignature(input: { prompt: string; platforms: string[]; language: string; attachedSourceId: string | null }): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}
export function answerEnvelope(value: unknown): StudioAnswerEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Partial<StudioAnswerEnvelope>
  if (row.origin !== 'studio-server.v1' || typeof row.signature !== 'string' || !/^[a-f0-9]{64}$/.test(row.signature)
    || typeof row.token !== 'string' || !/^[a-f0-9-]{36}$/.test(row.token)
    || !['pending', 'complete', 'failed', 'unknown'].includes(row.state ?? '')
    || typeof row.startedAt !== 'string' || !Number.isFinite(Date.parse(row.startedAt))) return null
  return row as StudioAnswerEnvelope
}
/** An abandoned claim is unknown, never permission to perform the paid call again. */
export function answerState(value: StudioAnswerEnvelope, now = Date.now()): StudioAnswerEnvelope['state'] {
  return value.state === 'pending' && now - Date.parse(value.startedAt) > 90_000 ? 'unknown' : value.state
}
export function projectManagedAnswer(value: unknown) {
  const envelope = answerEnvelope(value)
  if (!envelope) return null
  const state = answerState(envelope)
  if ((state === 'complete' || state === 'failed') && envelope.response) {
    return { answerState: state, live: { reply: envelope.response } }
  }
  const error = state === 'pending' ? ANSWER_PENDING : state === 'unknown' ? ANSWER_UNKNOWN : envelope.error ?? 'STUDIO_UNAVAILABLE'
  return { answerState: state, live: { error } }
}

/** All joins retain both parent and child ownership; callers have also authorized the active brand. */
export async function readOwnedAnswerTurn(access: StudioBrandAccess, threadId: string, position: number): Promise<OwnedAnswerTurn | null> {
  const rows = await access.sql`
    select u.id, u.prompt, u.live, u.reply, u.receipts
    from studio_thread_turns u join studio_threads t
      on t.id = u.thread_id and t.account_id = u.account_id and t.client_id = u.client_id and t.profile_id = u.profile_id
    where u.thread_id = ${threadId}::uuid and u.position = ${position}
      and u.account_id = ${access.accountId}::uuid and u.client_id = ${access.clientId}::uuid and u.profile_id = ${access.profileId}::uuid
      and t.account_id = ${access.accountId}::uuid and t.client_id = ${access.clientId}::uuid and t.profile_id = ${access.profileId}::uuid
    limit 1`
  const row = rows[0]
  if (!row) return null
  // Only server-composed snapshots have receipts. Legacy client-composed cards
  // and unavailable context are not promoted to verified brand facts. This is
  // the immutable current turn's already-read data, never a fresh tool request.
  const receipts = parseStudioReceipts(row.receipts)
  const saved = receipts?.some(receipt => receipt.kind === 'compose') && row.reply && typeof row.reply === 'object'
    ? JSON.stringify(row.reply) : null
  const savedContext = saved ? `${saved.slice(0, 4_000)}${saved.length > 4_000 ? '\n[Saved record excerpt truncated at 4,000 characters.]' : ''}` : null
  return { id: String(row.id), prompt: String(row.prompt), live: row.live ?? null, savedContext }
}

/** One short CAS statement commits the claim before quota reservation or external work. */
export async function claimStudioAnswer(access: StudioBrandAccess, turn: OwnedAnswerTurn, signature: string): Promise<StudioAnswerEnvelope | null> {
  const claim: StudioAnswerEnvelope = { origin: 'studio-server.v1', signature, token: randomUUID(), state: 'pending', startedAt: new Date().toISOString() }
  const rows = await access.sql`
    update studio_thread_turns set live = ${JSON.stringify(claim)}::jsonb
    where id = ${turn.id}::uuid and prompt = ${turn.prompt} and live is null
      and account_id = ${access.accountId}::uuid and client_id = ${access.clientId}::uuid and profile_id = ${access.profileId}::uuid
    returning id`
  return rows[0] ? claim : null
}

/** Completion can only replace this worker's pending claim. No network work holds a SQL transaction open. */
export async function finishStudioAnswer(access: StudioBrandAccess, turnId: string, claim: StudioAnswerEnvelope, result: {
  response?: StudioLiveReply; error?: string; status: number; state: 'complete' | 'failed' | 'unknown'
}): Promise<void> {
  const next: StudioAnswerEnvelope = { ...claim, ...result }
  const encoded = JSON.stringify(next)
  if (Buffer.byteLength(encoded) > 65_536) throw Error('Studio answer exceeds storage bound')
  const rows = await access.sql`
    update studio_thread_turns set live = ${encoded}::jsonb
    where id = ${turnId}::uuid
      and account_id = ${access.accountId}::uuid and client_id = ${access.clientId}::uuid and profile_id = ${access.profileId}::uuid
      and live->>'origin' = 'studio-server.v1' and live->>'token' = ${claim.token} and live->>'state' = 'pending'
    returning id`
  if (!rows[0]) throw Error('Studio answer claim no longer current')
}
