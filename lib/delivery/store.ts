import 'server-only'
import { db } from '@/lib/db'
import { retryWrite, versionDTO, versionLocks } from '@/lib/change-sets/store'
import type { ActorSnapshot, VersionDetail } from '@/lib/change-sets/types'
import { deliveryEventDTO } from './dto'
import { deliveryId, parseAttest, parseDeliveryQuery, parseWithdraw } from './input'
import type { AttestInput, DeliveryEvent, DeliveryPage, DeliveryQuery, DeliveryResult, DeliveryScope, WithdrawInput } from './types'

function unavailable(): never { throw new Error('DELIVERY_UNAVAILABLE') }
function normalizedScope(scope: DeliveryScope): DeliveryScope {
  return { accountId: deliveryId(scope.accountId), clientId: deliveryId(scope.clientId), itemId: deliveryId(scope.itemId),
    versionId: deliveryId(scope.versionId), actorId: deliveryId(scope.actorId) }
}
function ownedVersion(row: Record<string, unknown> | undefined): DeliveryResult<VersionDetail> {
  if (!row) unavailable()
  if (row.member === false) return { kind: 'denied' }
  if (row.member !== true || typeof row.owned !== 'boolean') unavailable()
  if (!row.owned || row.version === null) return { kind: 'not_found' }
  // Only retained-package mapping failures are 422; SQL exceptions stay 503.
  try { return { kind: 'replayed', value: versionDTO(row.version as Record<string, unknown>) } }
  catch { return { kind: 'validation_failed' } }
}
export async function readDeliveryVersion(rawScope: DeliveryScope): Promise<DeliveryResult<VersionDetail>> {
  let scope: DeliveryScope
  try { scope = normalizedScope(rawScope) } catch { return { kind: 'validation_failed' } }
  const { accountId, clientId, itemId, versionId, actorId } = scope
  let row: Record<string, unknown> | undefined
  try {
    const sql = db()
    ;[row] = await sql`WITH member AS MATERIALIZED (
      SELECT p.id FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid
    ), owned AS MATERIALIZED (
      SELECT d.id FROM evidence_work_items d JOIN clients c ON c.id = d.client_id AND c.account_id = d.account_id
      WHERE d.account_id = ${accountId}::uuid AND d.client_id = ${clientId}::uuid AND d.id = ${itemId}::uuid
        AND d.source_kind IN ('pulse-metric','scan-check') AND EXISTS (SELECT 1 FROM member)
    ), version AS (
      SELECT v.*,to_jsonb(r) AS decision_record,false AS can_decide FROM work_item_versions v
      LEFT JOIN work_item_decisions r ON r.account_id = v.account_id AND r.client_id = v.client_id
        AND r.work_item_id = v.work_item_id AND r.version_id = v.id AND r.content_hash = v.content_hash
      WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid AND v.work_item_id = ${itemId}::uuid
        AND v.id = ${versionId}::uuid AND EXISTS (SELECT 1 FROM owned)
    ) SELECT EXISTS (SELECT 1 FROM member) AS member,EXISTS (SELECT 1 FROM owned) AS owned,
      (SELECT to_jsonb(v) FROM version v) AS version`
  } catch { unavailable() }
  return ownedVersion(row)
}

export async function readDelivery(rawScope: DeliveryScope, rawQuery: DeliveryQuery): Promise<DeliveryResult<DeliveryPage>> {
  let scope: DeliveryScope, query: DeliveryQuery
  try {
    scope = normalizedScope(rawScope)
    if (typeof rawQuery.limit !== 'number' || !Number.isSafeInteger(rawQuery.limit)) throw new Error()
    const params = new URLSearchParams({ limit: String(rawQuery.limit) })
    if (rawQuery.cursor !== null) params.set('cursor', Buffer.from(JSON.stringify(rawQuery.cursor)).toString('base64url'))
    query = parseDeliveryQuery(params)
  } catch { return { kind: 'validation_failed' } }
  const { accountId, clientId, itemId, versionId, actorId } = scope
  let row: Record<string, unknown> | undefined
  try {
    const sql = db()
    ;[row] = await sql`WITH member AS MATERIALIZED (
      SELECT p.id FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid
    ), owned AS MATERIALIZED (
      SELECT d.id FROM evidence_work_items d JOIN clients c ON c.id = d.client_id AND c.account_id = d.account_id
      WHERE d.account_id = ${accountId}::uuid AND d.client_id = ${clientId}::uuid AND d.id = ${itemId}::uuid
        AND d.source_kind IN ('pulse-metric','scan-check') AND EXISTS (SELECT 1 FROM member)
    ), version AS MATERIALIZED (
      SELECT v.*,to_jsonb(r) AS decision_record,false AS can_decide FROM work_item_versions v
      LEFT JOIN work_item_decisions r ON r.account_id = v.account_id AND r.client_id = v.client_id
        AND r.work_item_id = v.work_item_id AND r.version_id = v.id AND r.content_hash = v.content_hash
      WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid AND v.work_item_id = ${itemId}::uuid
        AND v.id = ${versionId}::uuid AND EXISTS (SELECT 1 FROM owned)
    ), latest AS MATERIALIZED (
      SELECT id FROM work_item_versions WHERE account_id = ${accountId}::uuid AND client_id = ${clientId}::uuid
        AND work_item_id = ${itemId}::uuid AND EXISTS (SELECT 1 FROM owned) ORDER BY version_number DESC LIMIT 1
    ), active AS MATERIALIZED (
      SELECT e.id FROM work_item_delivery_events e JOIN version v ON e.account_id = v.account_id AND e.client_id = v.client_id
        AND e.work_item_id = v.work_item_id AND e.version_id = v.id AND e.content_hash = v.content_hash
      WHERE e.kind = 'attest' AND NOT EXISTS (SELECT 1 FROM work_item_delivery_events w
        WHERE w.account_id = e.account_id AND w.client_id = e.client_id AND w.work_item_id = e.work_item_id
          AND w.version_id = e.version_id AND w.target_attestation_id = e.id AND w.kind = 'withdraw')
    ), page AS (
      SELECT e.* FROM work_item_delivery_events e JOIN version v ON e.account_id = v.account_id AND e.client_id = v.client_id
        AND e.work_item_id = v.work_item_id AND e.version_id = v.id AND e.content_hash = v.content_hash
      WHERE (${query.cursor?.recordedAt ?? null}::timestamptz IS NULL OR (e.recorded_at,e.id) < (${query.cursor?.recordedAt ?? null}::timestamptz,${query.cursor?.id ?? null}::uuid))
      ORDER BY e.recorded_at DESC,e.id DESC LIMIT ${query.limit + 1}
    ) SELECT EXISTS (SELECT 1 FROM member) AS member,EXISTS (SELECT 1 FROM owned) AS owned,
      (SELECT to_jsonb(v) FROM version v) AS version,(SELECT id FROM latest) AS latest_id,
      COALESCE((SELECT jsonb_agg(id) FROM active),'[]'::jsonb) AS active_ids,
      COALESCE((SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object(
        'recorded_at',to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'delivered_at',to_char(e.delivered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
        ORDER BY e.recorded_at DESC,e.id DESC) FROM page e),'[]'::jsonb) AS events`
  } catch { unavailable() }
  const retained = ownedVersion(row)
  if (!('value' in retained)) return retained
  try {
    if (!Array.isArray(row!.events) || !Array.isArray(row!.active_ids) || row!.active_ids.length > 1) throw new Error()
    const all = row!.events.map(event => deliveryEventDTO(event as Record<string, unknown>))
    const events = all.slice(0, query.limit)
    const activeAttestationId = row!.active_ids.length ? deliveryId(row!.active_ids[0]) : null
    const latestId = deliveryId(row!.latest_id)
    const canExport = retained.value.decision?.decision === 'approved'
    const attestReason = !canExport ? 'not_approved' : latestId !== versionId ? 'superseded' : activeAttestationId ? 'active_attestation' : null
    const last = events.at(-1)
    return { kind: 'replayed', value: { events, activeAttestationId,
      capabilities: { canExport, canAttest: attestReason === null, canWithdraw: activeAttestationId !== null,
        attestReason, withdrawReason: activeAttestationId ? null : 'no_active_attestation' },
      nextCursor: all.length > query.limit && last ? Buffer.from(JSON.stringify({ recordedAt: last.recordedAt, id: last.eventId })).toString('base64url') : null } }
  } catch { return { kind: 'validation_failed' } }
}

function eventResult(row: Record<string, unknown> | undefined): DeliveryResult<DeliveryEvent> {
  if (!row) unavailable()
  if (row.kind === 'created' || row.kind === 'replayed') {
    try { return { kind: row.kind, value: deliveryEventDTO(row.value as Record<string, unknown>) } }
    catch { return { kind: 'validation_failed' } }
  }
  if (row.kind === 'not_found' || row.kind === 'denied' || row.kind === 'conflict' || row.kind === 'validation_failed') return { kind: row.kind }
  unavailable()
}
export async function attestDelivery(rawScope: DeliveryScope, raw: AttestInput): Promise<DeliveryResult<DeliveryEvent>> {
  let scope: DeliveryScope, input: AttestInput
  try { scope = normalizedScope(rawScope); input = parseAttest(raw) } catch { return { kind: 'validation_failed' } }
  const { accountId, clientId, itemId, versionId, actorId } = scope
  // Immutable package proof only. Every permission and eligibility decision is
  // re-established after acquiring the shared C9d locks, including historical retry.
  const retained = await readDeliveryVersion(scope)
  const validatedHash = 'value' in retained ? retained.value.contentHash : null
  try {
    return await retryWrite(async () => {
      const sql = db()
      const results = await sql.transaction([
        ...versionLocks(sql, accountId, clientId, itemId, actorId),
        sql`WITH member AS MATERIALIZED (
          SELECT p.id,p.display_name FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid
            AND p.id::text = current_setting('aiso.version_actor_locked', true)
        ), owned AS MATERIALIZED (
          SELECT d.id FROM evidence_work_items d JOIN clients c ON c.id = d.client_id AND c.account_id = d.account_id
          WHERE d.account_id = ${accountId}::uuid AND d.client_id = ${clientId}::uuid AND d.id = ${itemId}::uuid
            AND d.id::text = current_setting('aiso.version_item_locked', true) AND d.source_kind IN ('pulse-metric','scan-check')
            AND EXISTS (SELECT 1 FROM member)
        ), version AS MATERIALIZED (
          SELECT v.* FROM work_item_versions v WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid
            AND v.work_item_id = ${itemId}::uuid AND v.id = ${versionId}::uuid AND EXISTS (SELECT 1 FROM owned)
        ), prior AS MATERIALIZED (
          SELECT r.* FROM work_item_delivery_events r WHERE r.account_id = ${accountId}::uuid AND r.actor_id = ${actorId}::uuid
            AND r.request_id = ${input.requestId}::uuid AND EXISTS (SELECT 1 FROM version)
        ), replay AS MATERIALIZED (
          SELECT r.* FROM prior r WHERE r.kind = 'attest' AND r.client_id = ${clientId}::uuid AND r.work_item_id = ${itemId}::uuid
            AND r.version_id = ${versionId}::uuid AND r.content_hash = ${input.contentHash} AND r.destination = ${input.destination}
            AND r.delivered_at = ${input.deliveredAt}::timestamptz AND r.note = ${input.note}
        ), approval AS MATERIALIZED (
          SELECT a.* FROM work_item_decisions a JOIN version v ON a.account_id = v.account_id AND a.client_id = v.client_id
            AND a.work_item_id = v.work_item_id AND a.version_id = v.id AND a.content_hash = v.content_hash
          WHERE a.decision = 'approved'
        ), latest AS MATERIALIZED (
          SELECT max(version_number) AS number FROM work_item_versions WHERE account_id = ${accountId}::uuid
            AND client_id = ${clientId}::uuid AND work_item_id = ${itemId}::uuid
        ), active AS MATERIALIZED (
          SELECT e.id FROM work_item_delivery_events e JOIN version v ON e.account_id = v.account_id AND e.client_id = v.client_id
            AND e.work_item_id = v.work_item_id AND e.version_id = v.id AND e.content_hash = v.content_hash
          WHERE e.kind = 'attest' AND NOT EXISTS (SELECT 1 FROM work_item_delivery_events w WHERE w.account_id = e.account_id
            AND w.client_id = e.client_id AND w.work_item_id = e.work_item_id AND w.version_id = e.version_id
            AND w.target_attestation_id = e.id AND w.kind = 'withdraw')
        ), clock AS MATERIALIZED (SELECT clock_timestamp() AS now), inserted AS (
          INSERT INTO work_item_delivery_events (account_id,client_id,work_item_id,version_id,content_hash,approval_decision_id,approval_decision,
            kind,actor_id,actor,request_id,recorded_at,destination,delivered_at,note)
          SELECT v.account_id,v.client_id,v.work_item_id,v.id,v.content_hash,a.id,'approved','attest',p.id,
            jsonb_build_object('profileId',p.id,'displayName',p.display_name,'role','account_member'),${input.requestId}::uuid,clock.now,
            ${input.destination},${input.deliveredAt}::timestamptz,${input.note}
          FROM version v CROSS JOIN member p CROSS JOIN approval a CROSS JOIN clock
          WHERE NOT EXISTS (SELECT 1 FROM prior) AND NOT EXISTS (SELECT 1 FROM active)
            AND v.content_hash = ${validatedHash} AND v.content_hash = ${input.contentHash}
            AND v.version_number = (SELECT number FROM latest)
            AND ${input.deliveredAt}::timestamptz >= a.decided_at AND ${input.deliveredAt}::timestamptz <= clock.now
          RETURNING *
        ), chosen AS (SELECT * FROM inserted UNION ALL SELECT * FROM replay)
        SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM member) THEN 'denied'
          WHEN NOT EXISTS (SELECT 1 FROM version) THEN 'not_found'
          WHEN EXISTS (SELECT 1 FROM replay) THEN 'replayed'
          WHEN EXISTS (SELECT 1 FROM prior) THEN 'conflict'
          WHEN ${validatedHash}::text IS NULL THEN 'validation_failed'
          WHEN (SELECT content_hash FROM version) <> ${input.contentHash} THEN 'conflict'
          WHEN NOT EXISTS (SELECT 1 FROM approval) OR (SELECT version_number FROM version) <> (SELECT number FROM latest)
            OR EXISTS (SELECT 1 FROM active) THEN 'conflict'
          WHEN NOT EXISTS (SELECT 1 FROM approval a CROSS JOIN clock WHERE ${input.deliveredAt}::timestamptz >= a.decided_at
            AND ${input.deliveredAt}::timestamptz <= clock.now) THEN 'validation_failed'
          WHEN EXISTS (SELECT 1 FROM inserted) THEN 'created' ELSE 'conflict' END AS kind,
          (SELECT to_jsonb(e) || jsonb_build_object(
            'recorded_at',to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'delivered_at',to_char(e.delivered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) FROM chosen e LIMIT 1) AS value`
      ], { isolationLevel: 'ReadCommitted' })
      return eventResult(results.at(-1)?.[0])
    })
  } catch { unavailable() }
}

export async function withdrawDelivery(rawScope: DeliveryScope, rawAttestationId: string, raw: WithdrawInput): Promise<DeliveryResult<DeliveryEvent>> {
  let scope: DeliveryScope, attestationId: string, input: WithdrawInput
  try { scope = normalizedScope(rawScope); attestationId = deliveryId(rawAttestationId); input = parseWithdraw(raw) }
  catch { return { kind: 'validation_failed' } }
  const { accountId, clientId, itemId, versionId, actorId } = scope
  try {
    return await retryWrite(async () => {
      const sql = db()
      const results = await sql.transaction([
        ...versionLocks(sql, accountId, clientId, itemId, actorId),
        sql`WITH member AS MATERIALIZED (
          SELECT p.id,p.display_name FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid
            AND p.id::text = current_setting('aiso.version_actor_locked', true)
        ), owned AS MATERIALIZED (
          SELECT d.id FROM evidence_work_items d JOIN clients c ON c.id = d.client_id AND c.account_id = d.account_id
          WHERE d.account_id = ${accountId}::uuid AND d.client_id = ${clientId}::uuid AND d.id = ${itemId}::uuid
            AND d.id::text = current_setting('aiso.version_item_locked', true) AND d.source_kind IN ('pulse-metric','scan-check')
            AND EXISTS (SELECT 1 FROM member)
        ), version AS MATERIALIZED (
          SELECT v.* FROM work_item_versions v WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid
            AND v.work_item_id = ${itemId}::uuid AND v.id = ${versionId}::uuid AND EXISTS (SELECT 1 FROM owned)
        ), prior AS MATERIALIZED (
          SELECT r.* FROM work_item_delivery_events r WHERE r.account_id = ${accountId}::uuid AND r.actor_id = ${actorId}::uuid
            AND r.request_id = ${input.requestId}::uuid AND EXISTS (SELECT 1 FROM version)
        ), replay AS MATERIALIZED (
          SELECT r.* FROM prior r WHERE r.kind = 'withdraw' AND r.client_id = ${clientId}::uuid AND r.work_item_id = ${itemId}::uuid
            AND r.version_id = ${versionId}::uuid AND r.target_attestation_id = ${attestationId}::uuid AND r.reason = ${input.reason}
        ), target AS MATERIALIZED (
          SELECT e.* FROM work_item_delivery_events e JOIN version v ON e.account_id = v.account_id AND e.client_id = v.client_id
            AND e.work_item_id = v.work_item_id AND e.version_id = v.id AND e.content_hash = v.content_hash
          WHERE e.id = ${attestationId}::uuid AND e.kind = 'attest'
        ), withdrawn AS MATERIALIZED (
          SELECT w.id FROM work_item_delivery_events w JOIN target e ON w.account_id = e.account_id AND w.client_id = e.client_id
            AND w.work_item_id = e.work_item_id AND w.version_id = e.version_id AND w.target_attestation_id = e.id AND w.kind = 'withdraw'
        ), clock AS MATERIALIZED (SELECT clock_timestamp() AS now), inserted AS (
          INSERT INTO work_item_delivery_events (account_id,client_id,work_item_id,version_id,content_hash,kind,actor_id,actor,
            request_id,recorded_at,target_attestation_id,target_kind,reason)
          SELECT e.account_id,e.client_id,e.work_item_id,e.version_id,e.content_hash,'withdraw',p.id,
            jsonb_build_object('profileId',p.id,'displayName',p.display_name,'role','account_member'),${input.requestId}::uuid,clock.now,e.id,'attest',${input.reason}
          FROM target e CROSS JOIN member p CROSS JOIN clock
          WHERE NOT EXISTS (SELECT 1 FROM prior) AND NOT EXISTS (SELECT 1 FROM withdrawn)
          RETURNING *
        ), chosen AS (SELECT * FROM inserted UNION ALL SELECT * FROM replay)
        SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM member) THEN 'denied'
          WHEN NOT EXISTS (SELECT 1 FROM version) THEN 'not_found'
          WHEN EXISTS (SELECT 1 FROM replay) THEN 'replayed'
          WHEN EXISTS (SELECT 1 FROM prior) THEN 'conflict'
          WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
          WHEN EXISTS (SELECT 1 FROM withdrawn) THEN 'conflict'
          WHEN EXISTS (SELECT 1 FROM inserted) THEN 'created' ELSE 'conflict' END AS kind,
          (SELECT to_jsonb(e) || jsonb_build_object('recorded_at',to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
            FROM chosen e LIMIT 1) AS value`
      ], { isolationLevel: 'ReadCommitted' })
      return eventResult(results.at(-1)?.[0])
    })
  } catch { unavailable() }
}

/**
 * Records that an approved package left the system.
 *
 * Both hashes are kept because they answer different questions and need not be
 * equal: `contentHash` is the approved payload a human signed off, `artifactHash`
 * identifies the rendered canonical envelope. For the text format the delivered
 * bytes are a rendering of that same envelope, which is why the format and the
 * renderer version are stored beside the hash rather than left implied.
 *
 * Returns false when nothing was written. The caller fails the export rather than
 * handing over approved content with no receipt — a 2xx here has to mean the
 * write happened, and an export nobody can account for is the thing this table
 * exists to prevent. The composite foreign key is what makes a zero-row result
 * meaningful: it cannot match a version whose content differs from what was
 * exported.
 */
export async function recordExportEvent(
  scope: DeliveryScope,
  input: { contentHash: string; artifactHash: string; format: 'json' | 'text'; rendererVersion: string; actor: ActorSnapshot },
): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    insert into work_item_export_events (
      account_id, client_id, work_item_id, version_id, content_hash,
      artifact_hash, format, renderer_version, actor_id, actor
    )
    select ${scope.accountId}::uuid, ${scope.clientId}::uuid, ${scope.itemId}::uuid,
           ${scope.versionId}::uuid, ${input.contentHash},
           ${input.artifactHash}, ${input.format}, ${input.rendererVersion},
           ${scope.actorId}::uuid, ${JSON.stringify(input.actor)}::jsonb
    where exists (
      select 1 from work_item_versions v
      where v.account_id = ${scope.accountId}::uuid and v.client_id = ${scope.clientId}::uuid
        and v.work_item_id = ${scope.itemId}::uuid and v.id = ${scope.versionId}::uuid
        and v.content_hash = ${input.contentHash}
    )
    returning id
  `
  return rows.length > 0
}
