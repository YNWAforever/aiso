import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { retryWrite, versionLocks } from '@/lib/change-sets/store'
import type { HandoffScope } from './handoff-store'
import type { LiveFetch } from './live-check'

/**
 * Site-edit S4 store (migration 091). One statement, under the same item/actor
 * locks C9e attestation takes (versionLocks), re-establishes at write time:
 * the actor is an active member; the version is the LATEST, approved for
 * exactly `contentHash`; its job exists, was handed off (`sent` or `unknown`)
 * or reported completed, and was not declined. It then records the check, and
 * only when the payload was FOUND and no attestation is active, a C9e
 * attestation with provenance 'verified_live' bound to the job, delivered at
 * the check time. Nothing here trusts an id the caller supplied.
 */

export type LiveCheckWrite =
  | { kind: 'denied' }
  | { kind: 'not_found' }
  | { kind: 'ineligible' }
  | { kind: 'recorded'; outcome: LiveFetch['outcome']; attested: boolean; alreadyAttested: boolean }

const NOTE = 'Approved JSON-LD found on the live page at check time.'

export async function recordLiveCheck(scope: HandoffScope, contentHash: string, check: LiveFetch & { targetUrl: string }): Promise<LiveCheckWrite> {
  const { accountId, clientId, itemId, versionId, actorId } = scope
  const requestId = randomUUID()
  const destination = check.targetUrl.slice(0, 500)
  const row = await retryWrite(async () => {
    const sql = db()
    const results = await sql.transaction([
      ...versionLocks(sql, accountId, clientId, itemId, actorId),
      sql`
        WITH member AS MATERIALIZED (
          SELECT p.id, p.display_name FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid
            AND p.deactivated_at IS NULL AND p.id::text = current_setting('aiso.version_actor_locked', true)
        ), owned AS MATERIALIZED (
          SELECT d.id FROM evidence_work_items d JOIN clients c ON c.id = d.client_id AND c.account_id = d.account_id
          WHERE d.account_id = ${accountId}::uuid AND d.client_id = ${clientId}::uuid AND d.id = ${itemId}::uuid
            AND d.id::text = current_setting('aiso.version_item_locked', true) AND EXISTS (SELECT 1 FROM member)
        ), version AS MATERIALIZED (
          SELECT v.*, r.id AS decision_id, r.decided_at FROM work_item_versions v
          JOIN work_item_decisions r ON r.account_id = v.account_id AND r.client_id = v.client_id AND r.work_item_id = v.work_item_id
            AND r.version_id = v.id AND r.content_hash = v.content_hash AND r.decision = 'approved'
          WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid AND v.work_item_id = ${itemId}::uuid
            AND v.id = ${versionId}::uuid AND v.content_hash = ${contentHash} AND EXISTS (SELECT 1 FROM owned)
            AND v.version_number = (SELECT max(version_number) FROM work_item_versions WHERE account_id = ${accountId}::uuid
              AND client_id = ${clientId}::uuid AND work_item_id = ${itemId}::uuid)
        ), job AS MATERIALIZED (
          SELECT j.id FROM site_edit_jobs j JOIN version v ON j.account_id = v.account_id AND j.version_id = v.id
            AND j.content_hash = v.content_hash
          WHERE NOT EXISTS (SELECT 1 FROM site_edit_receipts r WHERE r.job_id = j.id AND r.account_id = j.account_id AND r.status = 'rejected')
            AND (EXISTS (SELECT 1 FROM site_edit_receipts r WHERE r.job_id = j.id AND r.account_id = j.account_id AND r.status = 'completed')
              OR (SELECT e.kind FROM site_edit_job_events e WHERE e.job_id = j.id AND e.account_id = j.account_id
                ORDER BY e.seq DESC LIMIT 1) IN ('sent', 'unknown'))
        ), active AS MATERIALIZED (
          SELECT e.id FROM work_item_delivery_events e JOIN version v ON e.account_id = v.account_id AND e.client_id = v.client_id
            AND e.work_item_id = v.work_item_id AND e.version_id = v.id AND e.content_hash = v.content_hash
          WHERE e.kind = 'attest' AND NOT EXISTS (SELECT 1 FROM work_item_delivery_events w WHERE w.account_id = e.account_id
            AND w.client_id = e.client_id AND w.work_item_id = e.work_item_id AND w.version_id = e.version_id
            AND w.target_attestation_id = e.id AND w.kind = 'withdraw')
        ), clock AS MATERIALIZED (SELECT clock_timestamp() AS now), attested AS (
          INSERT INTO work_item_delivery_events (account_id, client_id, work_item_id, version_id, content_hash, approval_decision_id,
            approval_decision, kind, actor_id, actor, request_id, recorded_at, destination, delivered_at, note, provenance, site_edit_job_id)
          SELECT v.account_id, v.client_id, v.work_item_id, v.id, v.content_hash, v.decision_id, 'approved', 'attest', p.id,
            jsonb_build_object('profileId', p.id, 'displayName', p.display_name, 'role', 'account_member'), ${requestId}::uuid, clock.now,
            ${destination}, ${check.checkedAt.toISOString()}::timestamptz, ${NOTE}, 'verified_live', j.id
          FROM version v CROSS JOIN member p CROSS JOIN job j CROSS JOIN clock
          WHERE ${check.outcome} = 'found' AND NOT EXISTS (SELECT 1 FROM active)
            AND ${check.checkedAt.toISOString()}::timestamptz >= v.decided_at AND ${check.checkedAt.toISOString()}::timestamptz <= clock.now
          RETURNING id
        ), checked AS (
          INSERT INTO site_edit_live_checks (job_id, account_id, outcome, http_status, page_sha256, checked_at, actor_id, attestation_id)
          SELECT j.id, ${accountId}::uuid, ${check.outcome}, ${check.httpStatus}, ${check.pageSha256},
            ${check.checkedAt.toISOString()}::timestamptz, p.id, (SELECT id FROM attested)
          FROM job j CROSS JOIN member p
          RETURNING id
        )
        SELECT EXISTS (SELECT 1 FROM member) AS member, EXISTS (SELECT 1 FROM owned) AS owned,
          EXISTS (SELECT 1 FROM checked) AS checked, EXISTS (SELECT 1 FROM attested) AS attested,
          EXISTS (SELECT 1 FROM active) AS already_attested`,
    ], { isolationLevel: 'ReadCommitted' })
    return results.at(-1)?.[0] as Record<string, unknown> | undefined
  })
  if (!row || 'kind' in row) throw new Error('LIVE_CHECK_UNAVAILABLE')
  if (row.member !== true) return { kind: 'denied' }
  if (row.owned !== true) return { kind: 'not_found' }
  if (row.checked !== true) return { kind: 'ineligible' }
  return { kind: 'recorded', outcome: check.outcome, attested: row.attested === true, alreadyAttested: row.already_attested === true }
}
