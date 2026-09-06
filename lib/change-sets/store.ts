import 'server-only'
import { db } from '@/lib/db'
import { readOwnedDraft } from '@/lib/work-items/store'
import type { WorkItem } from '@/lib/work-items/schema'
import { fingerprintEvidence } from '@/lib/opportunities/fingerprint'
import { freezeReview } from './validation'
import type { ActorSnapshot, DecisionDTO, FrozenReview, StoreResult, VersionDetail, VersionSummary } from './types'

export function validIds(...ids: string[]): boolean {
  return ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
}
function invalidSaved(): never { throw new Error('CHANGE_SET_UNAVAILABLE') }
function actor(value: unknown): ActorSnapshot {
  const a = value as ActorSnapshot
  if (!a || !validIds(a.profileId) || (a.displayName !== null && typeof a.displayName !== 'string') || !['account_member','account_approver','platform_admin'].includes(a.role)) invalidSaved()
  return { profileId: a.profileId, displayName: a.displayName, role: a.role }
}
function date(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value)
  if (!Number.isFinite(Date.parse(text))) invalidSaved()
  return text
}
export function versionDTO(row: Record<string, unknown>): VersionDetail {
  try {
    const c = row.content as FrozenReview['content']
    if (!validIds(String(row.id), String(row.work_item_id)) || !Number.isSafeInteger(Number(row.version_number)) || Number(row.version_number) < 1 || c.schemaVersion !== 1 || c.workItemId !== row.work_item_id || c.draftRevision !== Number(row.draft_revision)) invalidSaved()
    const frozen = freezeReview({ id: c.workItemId, revision: c.draftRevision, title: c.title, action: c.action, notes: c.notes, locale: c.locale, evidenceSnapshot: c.evidenceSnapshot } as WorkItem)
    if (frozen.contentHash !== row.content_hash || fingerprintEvidence(c) !== frozen.contentHash || fingerprintEvidence(row.validation) !== fingerprintEvidence(frozen.validation)) invalidSaved()
    const submittedBy = actor(row.submitter)
    const d = row.decision_record as Record<string, unknown> | null
    let decision: DecisionDTO | null = null
    if (d) {
      if (!['approved','changes_requested'].includes(String(d.decision)) || typeof d.reason !== 'string' || d.reason !== d.reason.trim().normalize('NFC') || Array.from(d.reason).length < 1 || Array.from(d.reason).length > 2000 || d.content_hash !== row.content_hash || d.version_id !== row.id) invalidSaved()
      const decidedBy = actor(d.actor)
      if (decidedBy.role !== 'account_approver' || decidedBy.profileId !== d.actor_id) invalidSaved()
      decision = { decision: d.decision as DecisionDTO['decision'], reason: d.reason, decidedBy, decidedAt: date(d.decided_at) }
    }
    return { ...frozen.content, id: String(row.id), versionNumber: Number(row.version_number), contentHash: frozen.contentHash, validation: frozen.validation, submittedBy, submittedAt: date(row.submitted_at), decision,
      capabilities: { canDecide: row.can_decide === true && decision === null } }
  } catch { invalidSaved() }
}
export async function retryWrite<T>(operation: () => Promise<T>): Promise<T | { kind: 'conflict' }> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation() } catch (error) {
      const code = (error as { code?: string })?.code
      if ((code === '40001' || code === '40P01') && attempt < 2) continue
      if (code === '23505') return { kind: 'conflict' }
      throw new Error('CHANGE_SET_UNAVAILABLE')
    }
  }
}
export function mutationResult(row: Record<string, unknown> | undefined): StoreResult<VersionDetail> {
  if (!row) return { kind: 'conflict' }
  if (row.kind === 'created' || row.kind === 'replayed') return { kind: row.kind, value: versionDTO(row.value as Record<string, unknown>) }
  if (row.kind === 'not_found' || row.kind === 'denied' || row.kind === 'validation_failed') return { kind: row.kind }
  return { kind: 'conflict' }
}

// These witnesses are initialized even when a row is absent. Subsequent statements
// must prove the current rows are the rows actually locked in this transaction.
export function versionLocks(sql: ReturnType<typeof db>, accountId: string, clientId: string, itemId: string, actorId: string) {
  return [
    sql`WITH locked AS MATERIALIZED (SELECT id FROM profiles WHERE id = ${actorId}::uuid ORDER BY id FOR SHARE)
      SELECT set_config('aiso.version_actor_locked', COALESCE((SELECT id::text FROM locked), ''), true)`,
    sql`WITH locked AS MATERIALIZED (
      SELECT d.id FROM evidence_work_items d WHERE d.account_id = ${accountId}::uuid AND d.client_id = ${clientId}::uuid AND d.id = ${itemId}::uuid
        AND d.source_kind IN ('pulse-metric','scan-check')
        AND EXISTS (SELECT 1 FROM clients c WHERE c.id = d.client_id AND c.account_id = d.account_id)
      FOR UPDATE)
      SELECT set_config('aiso.version_item_locked', COALESCE((SELECT id::text FROM locked), ''), true)`
  ]
}

export async function submitVersion(accountId: string, clientId: string, itemId: string, actorId: string, expectedRevision: number, supplied?: FrozenReview): Promise<StoreResult<VersionDetail>> {
  if (!validIds(accountId,clientId,itemId,actorId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return { kind: 'validation_failed' }
  ;[accountId,clientId,itemId,actorId] = [accountId,clientId,itemId,actorId].map(id => id.toLowerCase())
  let frozen: FrozenReview | null = null, preRevision: number | null = null
  // Defer validation outcome until after the locked replay lookup. Even a malformed
  // newer draft cannot prevent retrieval of an already saved revision.
  try {
    const sql = db()
    const saved = await sql`SELECT v.id FROM work_item_versions v
      JOIN clients c ON c.id = v.client_id AND c.account_id = v.account_id
      WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid AND v.work_item_id = ${itemId}::uuid AND v.draft_revision = ${expectedRevision}
        AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid)`
    const draft = saved.length ? null : await readOwnedDraft(accountId,clientId,itemId)
    if (draft) {
      preRevision = draft.revision
      if (draft.revision === expectedRevision) {
        frozen = freezeReview(draft)
        if (supplied && fingerprintEvidence(supplied) !== fingerprintEvidence(frozen)) frozen = null
      }
    }
  } catch (error) {
    const message = (error as Error)?.message ?? ''
    if (!/SNAPSHOT|VALIDATION|EVIDENCE|INVALID/.test(message)) throw new Error('CHANGE_SET_UNAVAILABLE')
  }
  const content = frozen?.content
  return retryWrite(async () => {
    const sql = db()
    const result = await sql.transaction([
      ...versionLocks(sql,accountId,clientId,itemId,actorId),
      sql`WITH member AS MATERIALIZED (
        SELECT p.id,p.display_name FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid
          AND p.id::text = current_setting('aiso.version_actor_locked', true)
      ), owned AS MATERIALIZED (
        SELECT d.* FROM evidence_work_items d JOIN clients c ON c.id = d.client_id AND c.account_id = d.account_id
        WHERE d.account_id = ${accountId}::uuid AND d.client_id = ${clientId}::uuid AND d.id = ${itemId}::uuid
          AND d.id::text = current_setting('aiso.version_item_locked', true)
          AND d.source_kind IN ('pulse-metric','scan-check') AND EXISTS (SELECT 1 FROM member)
      ), replay AS MATERIALIZED (
        SELECT v.* FROM work_item_versions v JOIN owned d ON d.id = v.work_item_id AND d.account_id = v.account_id AND d.client_id = v.client_id
        WHERE v.draft_revision = ${expectedRevision}
      ), inserted AS (
        INSERT INTO work_item_versions (account_id,client_id,work_item_id,version_number,draft_revision,content,content_hash,validation,submitter)
        SELECT d.account_id,d.client_id,d.id,
          (SELECT COALESCE(max(version_number),0)+1 FROM work_item_versions WHERE account_id = d.account_id AND client_id = d.client_id AND work_item_id = d.id),
          d.revision,${JSON.stringify(content ?? null)}::jsonb,${frozen?.contentHash ?? null},${JSON.stringify(frozen?.validation ?? null)}::jsonb,
          jsonb_build_object('profileId',p.id,'displayName',p.display_name,'role','account_member')
        FROM owned d CROSS JOIN member p WHERE NOT EXISTS (SELECT 1 FROM replay) AND ${frozen !== null}
          AND d.revision = ${expectedRevision} AND d.title = ${content?.title ?? null} AND d.action = ${content?.action ?? null}
          AND d.notes = ${content?.notes ?? null} AND d.locale = ${content?.locale ?? null}
          AND d.evidence_snapshot = ${JSON.stringify(content?.evidenceSnapshot ?? null)}::jsonb
        RETURNING *
      ), chosen AS (SELECT * FROM inserted UNION ALL SELECT * FROM replay)
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM member) THEN 'denied'
        WHEN NOT EXISTS (SELECT 1 FROM owned) THEN 'not_found'
        WHEN EXISTS (SELECT 1 FROM replay) THEN 'replayed'
        WHEN EXISTS (SELECT 1 FROM inserted) THEN 'created'
        WHEN (SELECT revision FROM owned) <> ${expectedRevision} OR ${preRevision}::bigint <> ${expectedRevision} THEN 'conflict'
        WHEN ${frozen === null} THEN 'validation_failed' ELSE 'conflict' END AS kind,
        (SELECT to_jsonb(v) || jsonb_build_object('can_decide',false,'decision_record',
          (SELECT to_jsonb(r) FROM work_item_decisions r WHERE r.account_id = v.account_id AND r.client_id = v.client_id AND r.work_item_id = v.work_item_id AND r.version_id = v.id)) FROM chosen v LIMIT 1) AS value`
    ], { isolationLevel: 'ReadCommitted' })
    return mutationResult(result.at(-1)?.[0])
  })
}

export type VersionPage = { versions: VersionSummary[]; nextCursor: string | null; latestVersionId: string | null }
export type VersionQuery = { limit: number; cursor: string | null }
function cursorNumber(query: VersionQuery): number | null {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 50) throw new Error('INVALID_CHANGE_SET_INPUT')
  if (query.cursor === null) return null
  try {
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(query.cursor)) throw new Error()
    const value = JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'))
    if (Object.keys(value).join(',') !== 'before' || !Number.isSafeInteger(value.before) || value.before < 1) throw new Error()
    return value.before
  } catch { throw new Error('INVALID_CHANGE_SET_INPUT') }
}
async function readRows(accountId: string, clientId: string, itemId: string, actorId: string, versionId: string | null, before: number | null, limit: number) {
  const sql = db()
  // A single statement owns the item, independent latest version and paginated rows
  // under one snapshot. No surviving source rows are needed for retained history.
  return sql`WITH owned AS MATERIALIZED (
    SELECT d.id FROM evidence_work_items d JOIN clients c ON c.id = d.client_id AND c.account_id = d.account_id
    WHERE d.account_id = ${accountId}::uuid AND d.client_id = ${clientId}::uuid AND d.id = ${itemId}::uuid AND d.source_kind IN ('pulse-metric','scan-check')
      AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid)
  ), latest AS MATERIALIZED (
    SELECT id,version_number FROM work_item_versions WHERE account_id = ${accountId}::uuid AND client_id = ${clientId}::uuid AND work_item_id = ${itemId}::uuid
      AND EXISTS (SELECT 1 FROM owned) ORDER BY version_number DESC LIMIT 1
  ), page AS (
    SELECT v.*,to_jsonb(r) AS decision_record,
      (r.id IS NULL AND v.version_number = (SELECT version_number FROM latest) AND v.submitter->>'profileId' <> ${actorId}
        AND EXISTS (SELECT 1 FROM profiles p JOIN account_approver_state s ON s.profile_id = p.id AND s.account_id = p.account_id
          JOIN account_approver_events e ON e.account_id = s.account_id AND e.profile_id = s.profile_id AND e.new_revision = s.revision AND e.id = s.last_event_id AND e.action = 'grant'
          WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid AND s.active IS TRUE)) AS can_decide
    FROM work_item_versions v LEFT JOIN work_item_decisions r ON r.account_id = v.account_id AND r.client_id = v.client_id AND r.work_item_id = v.work_item_id AND r.version_id = v.id
    WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid AND v.work_item_id = ${itemId}::uuid
      AND EXISTS (SELECT 1 FROM owned) AND (${versionId}::uuid IS NULL OR v.id = ${versionId}::uuid)
      AND (${before}::bigint IS NULL OR v.version_number < ${before}::bigint)
    ORDER BY v.version_number DESC LIMIT ${limit}
  ) SELECT EXISTS (SELECT 1 FROM owned) AS owned,(SELECT id FROM latest) AS latest_id,
    COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY version_number DESC) FROM page),'[]'::jsonb) AS versions`
}
export async function listVersions(accountId: string, clientId: string, itemId: string, actorId: string, query: VersionQuery): Promise<StoreResult<VersionPage>> {
  const before = cursorNumber(query)
  if (!validIds(accountId,clientId,itemId,actorId)) throw new Error('INVALID_CHANGE_SET_INPUT')
  ;[accountId,clientId,itemId,actorId] = [accountId,clientId,itemId,actorId].map(id => id.toLowerCase())
  const row = (await readRows(accountId,clientId,itemId,actorId,null,before,query.limit+1))[0]
  if (!row?.owned) return { kind: 'not_found' }
  const all = (row.versions as Record<string,unknown>[]).map(versionDTO)
  const versions = all.slice(0,query.limit).map(v => ({ schemaVersion:v.schemaVersion,id:v.id,versionNumber:v.versionNumber,workItemId:v.workItemId,draftRevision:v.draftRevision,contentHash:v.contentHash,submittedBy:v.submittedBy,submittedAt:v.submittedAt,decision:v.decision,capabilities:v.capabilities }))
  return { kind:'created',value:{versions,nextCursor:all.length>query.limit?Buffer.from(JSON.stringify({before:versions.at(-1)!.versionNumber})).toString('base64url'):null,latestVersionId:row.latest_id as string|null} }
}
export async function readVersion(accountId: string, clientId: string, itemId: string, versionId: string, actorId: string): Promise<StoreResult<VersionDetail>> {
  if (!validIds(accountId,clientId,itemId,versionId,actorId)) throw new Error('INVALID_CHANGE_SET_INPUT')
  ;[accountId,clientId,itemId,versionId,actorId] = [accountId,clientId,itemId,versionId,actorId].map(id => id.toLowerCase())
  const row = (await readRows(accountId,clientId,itemId,actorId,versionId,null,1))[0]
  const value = (row?.versions as Record<string,unknown>[] | undefined)?.[0]
  return row?.owned && value ? {kind:'created',value:versionDTO(value)} : {kind:'not_found'}
}
