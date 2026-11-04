import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Site-edit S3: the inbound receipt contract (brief §3a "Inbound"). Pure.
 *
 * `X-Rick-Signature: v1=<hex HMAC-SHA256(receiptSecret, timestamp + "." + rawBody)>`,
 * `X-Rick-Timestamp` in unix seconds within ±5 minutes. The receipt secret is
 * separate from the outbound one, so a leak of either direction cannot forge
 * the other; during a rotation the `_PREVIOUS` secret is accepted too.
 */

export const RECEIPT_BODY_LIMIT = 8 * 1024
const WINDOW_MS = 5 * 60_000
const MIN_SECRET = 32

export function receiptSecrets(env: Record<string, string | undefined> = process.env): string[] {
  return [env.SITE_EDIT_RECEIPT_SECRET, env.SITE_EDIT_RECEIPT_SECRET_PREVIOUS]
    .filter((s): s is string => typeof s === 'string' && s.length >= MIN_SECRET)
}

export function signReceipt(secret: string, timestamp: string, body: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

/** Constant-time over the RAW body; any secret in the rotation window may match. */
export function verifyReceiptSignature(secrets: string[], timestamp: string, body: string, signature: string, now = Date.now()): boolean {
  if (!secrets.length || !/^\d{10}$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > WINDOW_MS) return false
  if (!/^v1=[a-f0-9]{64}$/.test(signature)) return false
  const given = Buffer.from(signature.slice(3), 'hex')
  let ok = false
  for (const secret of secrets) {
    if (timingSafeEqual(Buffer.from(signReceipt(secret, timestamp, body).slice(3), 'hex'), given)) ok = true
  }
  return ok
}

export type ReceiptInput = { jobId: string; status: 'completed' | 'rejected'; url: string; completedAt: string; note: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

/** Strict keys: an extra field is refused, not ignored. */
export function parseReceipt(raw: unknown): ReceiptInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('RECEIPT_INVALID')
  const r = raw as Record<string, unknown>
  const allowed = ['jobId', 'status', 'url', 'completedAt', 'note']
  if (Object.keys(r).some(k => !allowed.includes(k))) throw new Error('RECEIPT_INVALID')
  if (typeof r.jobId !== 'string' || !UUID.test(r.jobId)) throw new Error('RECEIPT_INVALID')
  if (r.status !== 'completed' && r.status !== 'rejected') throw new Error('RECEIPT_INVALID')
  if (typeof r.url !== 'string' || r.url.length < 1 || r.url.length > 2048) throw new Error('RECEIPT_INVALID')
  if (typeof r.completedAt !== 'string' || !ISO.test(r.completedAt) || Number.isNaN(Date.parse(r.completedAt))) throw new Error('RECEIPT_INVALID')
  if (r.note !== undefined && r.note !== null && (typeof r.note !== 'string' || r.note.length > 2000)) throw new Error('RECEIPT_INVALID')
  return { jobId: r.jobId.toLowerCase(), status: r.status, url: r.url, completedAt: r.completedAt, note: typeof r.note === 'string' && r.note.trim() ? r.note : null }
}
