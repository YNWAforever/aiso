import 'server-only'
import { createHash } from 'node:crypto'
import { readOutcomeBody } from '@/lib/outcome-integrations/request'
import { RECEIPT_BODY_LIMIT, parseReceipt, receiptSecrets, verifyReceiptSignature } from './receipt'
import { loadReceiptJob, recordReceipt } from './receipt-store'

/**
 * Site-edit S3: `POST /api/site-edit/receipts` — the executor reports a job
 * completed or rejected. Public, and authenticated ONLY by the receipt HMAC
 * (brief §3a), the way webhooks/neon is by payload proof. Order:
 *
 *   1. receipt secret configured (else 503: nothing can verify a receipt);
 *   2. raw body ≤ 8 KiB, then the constant-time signature over those exact
 *      bytes and a ±5 min timestamp — before ANY database access;
 *   3. strict JSON keys;
 *   4. the job exists (an unknown id reads like a bad signature would: 404);
 *   5. an identical replay of the recorded receipt → 200, no write; a
 *      different body for a closed job → 409;
 *   6. the job was actually handed off (claim/sent/unknown; not failed);
 *   7. url equals the job's frozen editSpec.targetUrl.
 *
 * A receipt is the executor's claim, not proof; "verified" needs S4.
 */

const headers = { 'Cache-Control': 'no-store' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })

export async function receiveSiteEditReceipt(request: Request): Promise<Response> {
  const secrets = receiptSecrets()
  if (!secrets.length) return json({ error: 'RECEIPT_NOT_CONFIGURED' }, 503)

  let body: string
  try { body = await readOutcomeBody(request, RECEIPT_BODY_LIMIT) }
  catch (error) {
    const status = (error as { status?: number })?.status === 413 ? 413 : 400
    return json({ error: status === 413 ? 'RECEIPT_TOO_LARGE' : 'RECEIPT_INVALID' }, status)
  }
  if (!verifyReceiptSignature(secrets, request.headers.get('x-rick-timestamp') ?? '', body, request.headers.get('x-rick-signature') ?? '')) {
    return json({ error: 'RECEIPT_UNAUTHENTICATED' }, 401)
  }

  let input
  try { input = parseReceipt(JSON.parse(body)) } catch { return json({ error: 'RECEIPT_INVALID' }, 400) }
  const bodySha256 = createHash('sha256').update(body).digest('hex')

  try {
    const job = await loadReceiptJob(input.jobId)
    if (!job) return json({ error: 'RECEIPT_JOB_NOT_FOUND' }, 404)
    if (job.receipt) {
      return job.receipt.bodySha256 === bodySha256
        ? json({ received: true, replayed: true })
        : json({ error: 'RECEIPT_CONFLICT' }, 409)
    }
    if (job.lastEvent === null || job.lastEvent === 'failed') return json({ error: 'RECEIPT_JOB_NOT_OPEN' }, 409)
    if (!job.targetUrl || input.url !== job.targetUrl) return json({ error: 'RECEIPT_URL_MISMATCH' }, 422)
    const result = await recordReceipt({ ...input, jobId: job.jobId, accountId: job.accountId, bodySha256 })
    if (result === 'conflict') return json({ error: 'RECEIPT_CONFLICT' }, 409)
    return json({ received: true, replayed: result === 'replayed' }, result === 'created' ? 201 : 200)
  } catch (error) {
    // Never a 2xx over a failed write: the executor must retry.
    console.error('[site-edit] receipt failed', { name: error instanceof Error ? error.name : typeof error })
    return json({ error: 'RECEIPT_UNAVAILABLE' }, 503)
  }
}
