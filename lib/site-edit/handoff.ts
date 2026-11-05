import { createHmac } from 'node:crypto'
import type { EditSpecV1 } from './edit-spec'

/**
 * Site-edit S2: the outbound hand-off contract (brief §3a). Pure — no I/O —
 * so the exact bytes AISO signs and the state it derives are unit-testable.
 */

export const HANDOFF_DEADLINE_MS = 10_000
/** A claim older than this with no outcome row means the process died mid-call. */
export const HANDOFF_STALE_MS = 60_000

/**
 * S8 cap (Willy, 2026-11-05): at most 10 site edits handed off per brand per
 * calendar month, Hong Kong time. A "send" is a job (one per approved version,
 * a revert included) with an accepted (`sent`) or possibly-accepted
 * (`unknown`) outcome, or a claim still in flight, this month. Re-sending a job
 * already counted this month adds nothing.
 */
export const SITE_EDIT_MONTHLY_SENDS_PER_BRAND = 10
export const SITE_EDIT_CAP_TIME_ZONE = 'Asia/Hong_Kong'
const MIN_SECRET = 32

export type HandoffConfig = { url: string; secret: string }

/**
 * Both names must be set, the URL must be https, and the secret long enough.
 * Anything else reads as "not connected": the send button is disabled and no
 * request is ever made (brief §3a, Secrets).
 */
export function handoffConfig(env: Record<string, string | undefined> = process.env): HandoffConfig | null {
  const url = env.SITE_EDIT_EXECUTOR_URL?.trim()
  const secret = env.SITE_EDIT_EXECUTOR_SECRET
  if (!url || !secret || secret.length < MIN_SECRET) return null
  try {
    if (new URL(url).protocol !== 'https:') return null
  } catch { return null }
  return { url, secret }
}

export type HandoffBodyInput = {
  jobId: string
  versionId: string
  contentHash: string
  client: { id: string; name: string; verifiedDomain: string }
  editSpec: EditSpecV1
  approvedAt: string
  receiptUrl: string
}

/** The body, with keys in the contract's canonical order so the signature is reproducible. */
export function handoffBody(input: HandoffBodyInput): string {
  return JSON.stringify({
    jobId: input.jobId,
    versionId: input.versionId,
    contentHash: input.contentHash,
    client: { id: input.client.id, name: input.client.name, verifiedDomain: input.client.verifiedDomain },
    editSpec: input.editSpec,
    approvedAt: input.approvedAt,
    receiptUrl: input.receiptUrl,
  })
}

/** `v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>` */
export function handoffSignature(secret: string, timestamp: number, body: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export type HandoffOutcome =
  | { kind: 'sent'; status: number; ref: string | null }
  | { kind: 'failed'; status: number }
  | { kind: 'unknown' }

/** 2xx → sent, 4xx/5xx → failed; anything else (1xx/3xx) cannot be trusted as either. */
export function outcomeFor(status: number, ref: string | null): HandoffOutcome {
  if (status >= 200 && status <= 299) return { kind: 'sent', status, ref }
  if (status >= 400 && status <= 599) return { kind: 'failed', status }
  return { kind: 'unknown' }
}

/** The executor's own job reference, if it sent one we can show; never trusted beyond display. */
export function executorRef(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const ref = (body as Record<string, unknown>).reference ?? (body as Record<string, unknown>).jobReference
  if (typeof ref !== 'string') return null
  const clean = ref.trim()
  return clean.length >= 1 && clean.length <= 200 && !/[\u0000-\u001f]/.test(clean) ? clean : null
}

export type HandoffEvent = { seq: number; kind: 'claim' | 'sent' | 'failed' | 'unknown'; at: string; executorStatus: number | null; executorRef: string | null }
export type HandoffState = 'none' | 'sending' | 'sent' | 'failed' | 'unknown'

/** Newest event wins; a claim with no outcome is "sending" until it goes stale, then "unknown". */
export function handoffState(events: HandoffEvent[], now: Date): HandoffState {
  const latest = [...events].sort((a, b) => b.seq - a.seq)[0]
  if (!latest) return 'none'
  if (latest.kind !== 'claim') return latest.kind
  return now.getTime() - Date.parse(latest.at) > HANDOFF_STALE_MS ? 'unknown' : 'sending'
}
