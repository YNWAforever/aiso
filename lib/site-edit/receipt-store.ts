import 'server-only'
import { db } from '@/lib/db'

/**
 * Site-edit S3 store (migration 090).
 *
 * loadReceiptJob is account-blind BY DESIGN: the receipt endpoint has no
 * session, and the job id — an opaque UUID AISO minted and sent only to the
 * executor, inside a body it signed — is what establishes scope, the way
 * loadOutcomeCredential's key id does. It is reached only after the receipt's
 * HMAC has verified. Every row it returns carries its own account, and the
 * write below is bound to that account through 090's composite FK.
 */

export type ReceiptJob = {
  jobId: string
  accountId: string
  targetUrl: string | null
  lastEvent: 'claim' | 'sent' | 'failed' | 'unknown' | null
  receipt: { bodySha256: string } | null
}

export async function loadReceiptJob(jobId: string): Promise<ReceiptJob | null> {
  const [row] = await db()`
    SELECT j.id, j.account_id, v.content->'editSpec'->>'targetUrl' AS target_url,
      (SELECT e.kind FROM site_edit_job_events e WHERE e.job_id = j.id AND e.account_id = j.account_id ORDER BY e.seq DESC LIMIT 1) AS last_event,
      (SELECT r.body_sha256 FROM site_edit_receipts r WHERE r.job_id = j.id AND r.account_id = j.account_id) AS body_sha256
    FROM site_edit_jobs j
    JOIN work_item_versions v ON v.account_id = j.account_id AND v.client_id = j.client_id
      AND v.work_item_id = j.work_item_id AND v.id = j.version_id AND v.content_hash = j.content_hash
    WHERE j.id = ${jobId}::uuid`
  if (!row) return null
  const last = row.last_event
  return {
    jobId: String(row.id),
    accountId: String(row.account_id),
    targetUrl: typeof row.target_url === 'string' ? row.target_url : null,
    lastEvent: last === 'claim' || last === 'sent' || last === 'failed' || last === 'unknown' ? last : null,
    receipt: typeof row.body_sha256 === 'string' ? { bodySha256: row.body_sha256 } : null,
  }
}

export type RecordReceiptResult = 'created' | 'replayed' | 'conflict'

/** One receipt per job. Same raw body again → replayed (no write); a different one → conflict. */
export async function recordReceipt(input: { jobId: string; accountId: string; status: 'completed' | 'rejected'; url: string;
  completedAt: string; note: string | null; bodySha256: string }): Promise<RecordReceiptResult> {
  const sql = db()
  const inserted = await sql`
    INSERT INTO site_edit_receipts (job_id, account_id, status, url, completed_at, note, body_sha256)
    VALUES (${input.jobId}::uuid, ${input.accountId}::uuid, ${input.status}, ${input.url}, ${input.completedAt}::timestamptz,
      ${input.note}, ${input.bodySha256})
    ON CONFLICT (job_id) DO NOTHING
    RETURNING id`
  if (inserted.length === 1) return 'created'
  const [existing] = await sql`
    SELECT body_sha256 FROM site_edit_receipts WHERE job_id = ${input.jobId}::uuid AND account_id = ${input.accountId}::uuid`
  if (!existing) throw new Error('RECEIPT_UNAVAILABLE')
  return existing.body_sha256 === input.bodySha256 ? 'replayed' : 'conflict'
}
