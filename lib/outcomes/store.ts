import 'server-only'
import { db } from '@/lib/db'
import { validIds } from '@/lib/change-sets/store'
import { projectOutcomeSnapshot } from './sources'
import type { OutcomeInput, OutcomeScope } from './types'

export async function readOutcomeInput(scope: OutcomeScope): Promise<{kind:'ok';value:OutcomeInput}|{kind:'not_found'|'denied'|'unavailable'}> {
 try {
  if (!validIds(scope.accountId, scope.actorId, scope.clientId, scope.itemId, scope.versionId)) return {kind:'unavailable'}
  const [accountId,actorId,clientId,itemId,versionId] = [scope.accountId,scope.actorId,scope.clientId,scope.itemId,scope.versionId].map(id=>id.toLowerCase())
  const sql = db()
  const [row] = await sql`WITH member AS MATERIALIZED (
    SELECT p.id FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid
  ), owned AS MATERIALIZED (
    SELECT d.id FROM evidence_work_items d JOIN clients c ON c.id = d.client_id AND c.account_id = d.account_id
    WHERE d.account_id = ${accountId}::uuid AND d.client_id = ${clientId}::uuid AND d.id = ${itemId}::uuid
      AND d.source_kind IN ('pulse-metric','scan-check') AND EXISTS (SELECT 1 FROM member)
  ), version AS MATERIALIZED (
    SELECT v.*,to_jsonb(r) || jsonb_build_object(
      'decided_at',to_char(r.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS decision_record,
      false AS can_decide FROM work_item_versions v
    LEFT JOIN work_item_decisions r ON r.account_id = v.account_id AND r.client_id = v.client_id
      AND r.work_item_id = v.work_item_id AND r.version_id = v.id AND r.content_hash = v.content_hash
    WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid AND v.work_item_id = ${itemId}::uuid
      AND v.id = ${versionId}::uuid AND EXISTS (SELECT 1 FROM owned)
  ), history AS MATERIALIZED (
    SELECT e.* FROM work_item_delivery_events e JOIN version v ON e.account_id = v.account_id AND e.client_id = v.client_id
      AND e.work_item_id = v.work_item_id AND e.version_id = v.id AND e.content_hash = v.content_hash
    -- Keep complete same-version history; the projector validates approval_decision_id and derives active state.
  ), scan_candidates AS MATERIALIZED (
    SELECT s.id,s.created_at,s.results -> 'evidence' AS envelope FROM scans s
    JOIN version v ON s.account_id = v.account_id AND s.client_id = v.client_id
    JOIN clients c ON c.id = s.client_id AND c.account_id = s.account_id
    WHERE v.content #>> '{evidenceSnapshot,source,kind}' = 'scan-check'
    -- All envelopes may contain the original check. Do not cast untrusted JSON time or discard malformed envelopes.
    -- A 201st historical row prevents an exhaustive window claim, even if the first 200 are outside the intervals.
    ORDER BY s.created_at DESC NULLS LAST,s.id DESC LIMIT 201
  ), pulse_candidates AS MATERIALIZED (
    SELECT m.id,m.question,m.platform,m.prompt_id,m.created_at,m.brand_mentioned,
      coalesce(m.raw_answer ~ '[^[:space:]]',false) AS has_answer
    FROM pulse_metrics m JOIN version v ON m.client_id = v.client_id
    JOIN clients c ON c.id = m.client_id AND c.account_id = v.account_id
    WHERE v.content #>> '{evidenceSnapshot,source,kind}' = 'pulse-metric'
      AND m.question = v.content #>> '{evidenceSnapshot,evidence,question}'
      AND m.platform = v.content #>> '{evidenceSnapshot,evidence,platform}'
      AND ((v.content #>> '{evidenceSnapshot,evidence,promptId}') IS NULL
        OR m.prompt_id::text = v.content #>> '{evidenceSnapshot,evidence,promptId}')
    ORDER BY m.created_at DESC NULLS LAST,m.id DESC LIMIT 201
  ) SELECT EXISTS (SELECT 1 FROM member) AS member,EXISTS (SELECT 1 FROM owned) AS owned,
    to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS evaluated_at,
    (SELECT to_jsonb(v) || jsonb_build_object(
      'submitted_at',to_char(v.submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) FROM version v) AS version,
    COALESCE((SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object(
      'approval_decision_id',e.approval_decision_id,
      'recorded_at',to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'delivered_at',to_char(e.delivered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
      ORDER BY e.recorded_at,e.id) FROM history e),'[]'::jsonb) AS events,
    COALESCE((SELECT jsonb_agg(to_jsonb(s) || jsonb_build_object(
      'created_at',to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
      ORDER BY s.created_at DESC NULLS LAST,s.id DESC) FROM scan_candidates s),'[]'::jsonb) AS scans,
    COALESCE((SELECT jsonb_agg(to_jsonb(m) || jsonb_build_object(
      'created_at',to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
      ORDER BY m.created_at DESC NULLS LAST,m.id DESC) FROM pulse_candidates m),'[]'::jsonb) AS pulse`
  if (!row) return {kind:'unavailable'}
  if (row.member === false) return {kind:'denied'}
  if (row.member !== true || typeof row.owned !== 'boolean') return {kind:'unavailable'}
  if (!row.owned || row.version === null) return {kind:'not_found'}
  if (row.version.account_id !== accountId || row.version.client_id !== clientId ||
      row.version.work_item_id !== itemId || row.version.id !== versionId) return {kind:'unavailable'}
  return {kind:'ok',value:projectOutcomeSnapshot(row)}
 } catch { return {kind:'unavailable'} }
}
