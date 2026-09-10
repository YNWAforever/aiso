import 'server-only'
import { db } from '@/lib/db'
import { mutationResult, readVersion, retryWrite, validIds, versionLocks } from '@/lib/change-sets/store'
import type { ReviewDecisionInput, StoreResult, VersionDetail } from '@/lib/change-sets/types'
import { parseReviewDecision } from './input'

export async function decideVersion(accountId: string, clientId: string, itemId: string, versionId: string, actorId: string, raw: ReviewDecisionInput): Promise<StoreResult<VersionDetail>> {
  let input: ReviewDecisionInput
  try {
    if (!validIds(accountId,clientId,itemId,versionId,actorId)) return {kind:'validation_failed'}
    input = parseReviewDecision(raw)
  } catch { return {kind:'validation_failed'} }
  ;[accountId,clientId,itemId,versionId,actorId] = [accountId,clientId,itemId,versionId,actorId].map(id => id.toLowerCase())
  // Validate the immutable retained package; the write binds the exact validated hash.
  const retained = await readVersion(accountId,clientId,itemId,versionId,actorId)
  const hash = 'value' in retained ? retained.value.contentHash : null
  return retryWrite(async () => {
    const sql = db()
    const results = await sql.transaction([
      ...versionLocks(sql,accountId,clientId,itemId,actorId),
      sql`SELECT profile_id FROM account_approver_state WHERE account_id = ${accountId}::uuid AND profile_id = ${actorId}::uuid FOR UPDATE`,
      sql`WITH member AS MATERIALIZED (
        SELECT p.id,p.display_name FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid
          AND p.id::text = current_setting('aiso.version_actor_locked', true)
      ), owned AS MATERIALIZED (
        SELECT d.id,d.created_by,d.updated_by FROM evidence_work_items d JOIN clients c ON c.id = d.client_id AND c.account_id = d.account_id
        WHERE d.account_id = ${accountId}::uuid AND d.client_id = ${clientId}::uuid AND d.id = ${itemId}::uuid
          AND d.id::text = current_setting('aiso.version_item_locked', true) AND d.source_kind IN ('pulse-metric','scan-check')
          AND EXISTS (SELECT 1 FROM member)
      ), version AS MATERIALIZED (
        SELECT v.* FROM work_item_versions v WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid
          AND v.work_item_id = ${itemId}::uuid AND v.id = ${versionId}::uuid AND EXISTS (SELECT 1 FROM owned)
      ), separated AS MATERIALIZED (
        -- Separation of duties, the whole of it. The submitter check alone let a
        -- SECOND editor approve work they had written but not submitted, which is
        -- the same person reviewing their own text with a step in between. The
        -- item's authors are excluded too.
        --
        -- A pure tightening: a single-owner account already could not approve,
        -- because the submitter check has always been absolute. An explicit
        -- single-owner policy is deliberately NOT added here -- it would have to
        -- be recorded per decision so a solo sign-off is never presented as
        -- two-person review, and that is its own change.
        SELECT 1 FROM owned d
        WHERE coalesce(d.created_by::text,'') <> ${actorId}
          AND coalesce(d.updated_by::text,'') <> ${actorId}
      ), prior AS MATERIALIZED (
        SELECT r.* FROM work_item_decisions r JOIN version v ON r.account_id = v.account_id AND r.client_id = v.client_id AND r.work_item_id = v.work_item_id AND r.version_id = v.id
      ), replay AS MATERIALIZED (
        SELECT * FROM prior WHERE actor_id = ${actorId}::uuid AND request_id = ${input.requestId}::uuid AND decision = ${input.decision} AND reason = ${input.reason}
      ), active_grant AS MATERIALIZED (
        SELECT s.revision,s.last_event_id FROM account_approver_state s
        JOIN account_approver_events e ON e.account_id = s.account_id AND e.profile_id = s.profile_id AND e.new_revision = s.revision AND e.id = s.last_event_id AND e.action = 'grant'
        WHERE s.account_id = ${accountId}::uuid AND s.profile_id = ${actorId}::uuid AND s.active IS TRUE AND EXISTS (SELECT 1 FROM member)
      ), latest AS MATERIALIZED (
        SELECT max(version_number) AS number FROM work_item_versions WHERE account_id = ${accountId}::uuid AND client_id = ${clientId}::uuid AND work_item_id = ${itemId}::uuid
      ), inserted AS (
        INSERT INTO work_item_decisions (account_id,client_id,work_item_id,version_id,content_hash,decision,reason,actor_id,actor,grant_revision,grant_event_id,request_id)
        SELECT v.account_id,v.client_id,v.work_item_id,v.id,v.content_hash,${input.decision},${input.reason},p.id,
          jsonb_build_object('profileId',p.id,'displayName',p.display_name,'role','account_approver'),g.revision,g.last_event_id,${input.requestId}::uuid
        FROM version v CROSS JOIN member p CROSS JOIN active_grant g
        WHERE NOT EXISTS (SELECT 1 FROM prior) AND v.submitter->>'profileId' <> ${actorId} AND EXISTS (SELECT 1 FROM separated)
          AND v.version_number = (SELECT number FROM latest) AND v.content_hash = ${hash}
        RETURNING *
      ), chosen AS (SELECT * FROM inserted UNION ALL SELECT * FROM replay)
      SELECT CASE WHEN EXISTS (SELECT 1 FROM replay) THEN 'replayed'
        WHEN NOT EXISTS (SELECT 1 FROM member) THEN 'denied'
        WHEN NOT EXISTS (SELECT 1 FROM version) THEN 'not_found'
        WHEN EXISTS (SELECT 1 FROM prior) THEN 'conflict'
        WHEN NOT EXISTS (SELECT 1 FROM active_grant) OR (SELECT submitter->>'profileId' FROM version) = ${actorId}
          OR NOT EXISTS (SELECT 1 FROM separated) THEN 'denied'
        WHEN (SELECT version_number FROM version) <> (SELECT number FROM latest) THEN 'conflict'
        WHEN EXISTS (SELECT 1 FROM inserted) THEN 'created' ELSE 'conflict' END AS kind,
        (SELECT to_jsonb(v) || jsonb_build_object('can_decide',false,'decision_record',(SELECT to_jsonb(r) FROM chosen r LIMIT 1)) FROM version v) AS value`
    ], {isolationLevel:'ReadCommitted'})
    return mutationResult(results.at(-1)?.[0])
  })
}
