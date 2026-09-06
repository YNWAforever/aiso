import { db } from '@/lib/db'
import { parseApproverAccess } from './input'
import type { ActorSnapshot, ApproverAccessInput, StoreResult } from '@/lib/change-sets/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error('INVALID_APPROVAL_INPUT')
  return value.toLowerCase()
}
export type AccessQuery = { limit: number; memberCursor: string | null; eventCursor: { createdAt: string; id: string } | null }
export type AccessMemberDTO = { profileId: string; displayName: string | null; active: boolean; revision: number }
export type AccessEventDTO = { id: string; profileId: string; action: 'grant' | 'revoke'; previousRevision: number; newRevision: number; administrator: ActorSnapshot; reason: string; createdAt: string }
export type AccessPageDTO = { members: AccessMemberDTO[]; events: AccessEventDTO[]; nextMemberCursor: string | null; nextEventCursor: string | null }
export function parseAccessQuery(params: URLSearchParams): AccessQuery {
  const allowed = ['limit', 'memberCursor', 'eventCursor']
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new Error('INVALID_APPROVAL_INPUT')
  const raw = params.get('limit')
  const limit = raw === null ? 20 : Number(raw)
  if ((raw !== null && !/^[1-9]\d*$/.test(raw)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('INVALID_APPROVAL_INPUT')
  const memberCursor = params.has('memberCursor') ? uuid(params.get('memberCursor')!) : null
  let eventCursor: AccessQuery['eventCursor'] = null
  const encoded = params.get('eventCursor')
  if (encoded !== null) {
    try {
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(encoded)) throw new Error()
      const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
      if (!value || Object.keys(value).sort().join(',') !== 'createdAt,id' || typeof value.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error()
      eventCursor = { createdAt: value.createdAt, id: uuid(value.id) }
    } catch { throw new Error('INVALID_APPROVAL_INPUT') }
  }
  return { limit, memberCursor, eventCursor }
}
function event(row: Record<string, unknown>): AccessEventDTO {
  const actor = row.administrator as ActorSnapshot
  return { id: String(row.id), profileId: String(row.profile_id), action: row.action as 'grant' | 'revoke', previousRevision: Number(row.previous_revision), newRevision: Number(row.new_revision), administrator: { profileId: actor.profileId, displayName: actor.displayName, role: 'platform_admin' }, reason: String(row.reason), createdAt: String(row.created_at) }
}

export async function listApproverAccess(actorId: string, accountId: string, query: AccessQuery): Promise<StoreResult<AccessPageDTO>> {
  actorId = uuid(actorId); accountId = uuid(accountId)
  const sql = db()
  if (!(await sql`SELECT id FROM profiles WHERE id = ${actorId}::uuid AND is_admin IS TRUE`).length) return { kind: 'denied' }
  const accounts = await sql`SELECT id FROM accounts WHERE id = ${accountId}::uuid AND EXISTS (SELECT 1 FROM profiles WHERE id = ${actorId}::uuid AND is_admin IS TRUE)`
  if (!accounts.length) return { kind: 'not_found' }
  const members = await sql`
    SELECT p.id, p.display_name, COALESCE(s.revision, 0) AS revision,
      COALESCE(s.active AND e.action = 'grant', false) AS active
    FROM profiles p LEFT JOIN account_approver_state s ON s.account_id = p.account_id AND s.profile_id = p.id
    LEFT JOIN account_approver_events e ON e.account_id = s.account_id AND e.profile_id = s.profile_id AND e.new_revision = s.revision AND e.id = s.last_event_id
    WHERE p.account_id = ${accountId}::uuid AND (${query.memberCursor}::uuid IS NULL OR p.id > ${query.memberCursor}::uuid)
      AND EXISTS (SELECT 1 FROM profiles WHERE id = ${actorId}::uuid AND is_admin IS TRUE)
    ORDER BY p.id ASC LIMIT ${query.limit + 1}`
  const events = await sql`
    SELECT id, profile_id, action, previous_revision, new_revision, administrator, reason,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
    FROM account_approver_events WHERE account_id = ${accountId}::uuid
      AND (${query.eventCursor?.createdAt ?? null}::timestamptz IS NULL OR (created_at, id) < (${query.eventCursor?.createdAt ?? null}::timestamptz, ${query.eventCursor?.id ?? null}::uuid))
      AND EXISTS (SELECT 1 FROM profiles WHERE id = ${actorId}::uuid AND is_admin IS TRUE)
    ORDER BY created_at DESC, id DESC LIMIT ${query.limit + 1}`
  const pageMembers = members.slice(0, query.limit).map(row => ({ profileId: String(row.id), displayName: row.display_name as string | null, active: row.active === true, revision: Number(row.revision) }))
  const pageEvents = events.slice(0, query.limit).map(event)
  const lastEvent = pageEvents.at(-1)
  return { kind: 'created', value: { members: pageMembers, events: pageEvents,
    nextMemberCursor: members.length > query.limit ? pageMembers.at(-1)!.profileId : null,
    nextEventCursor: events.length > query.limit && lastEvent ? Buffer.from(JSON.stringify({ createdAt: lastEvent.createdAt, id: lastEvent.id })).toString('base64url') : null } }
}

export async function mutateApproverAccess(actorId: string, accountId: string, raw: ApproverAccessInput): Promise<StoreResult<AccessEventDTO>> {
  let input: ApproverAccessInput
  try { actorId = uuid(actorId); accountId = uuid(accountId); input = parseApproverAccess(raw) } catch { return { kind: 'validation_failed' } }
  for (let attempt = 0; ; attempt++) {
    try {
      const sql = db()
      if (!(await sql`SELECT id FROM profiles WHERE id = ${actorId}::uuid AND is_admin IS TRUE`).length) return { kind: 'denied' }
      // Build lazy promises in UUID order; the target lock also serializes absent state.
      const locks = [...new Set([actorId, input.profileId])].sort().map(id => {
        if (id === actorId && id === input.profileId) return sql`
          WITH locked AS MATERIALIZED (SELECT id FROM profiles WHERE id = ${id}::uuid ORDER BY id FOR UPDATE)
          SELECT set_config('aiso.approval_actor_locked', COALESCE((SELECT id::text FROM locked), ''), true),
            set_config('aiso.approval_target_locked', COALESCE((SELECT id::text FROM locked), ''), true)`
        if (id === input.profileId) return sql`
          WITH locked AS MATERIALIZED (SELECT id FROM profiles WHERE id = ${id}::uuid ORDER BY id FOR UPDATE)
          SELECT set_config('aiso.approval_target_locked', COALESCE((SELECT id::text FROM locked), ''), true)`
        return sql`
          WITH locked AS MATERIALIZED (SELECT id FROM profiles WHERE id = ${id}::uuid ORDER BY id FOR SHARE)
          SELECT set_config('aiso.approval_actor_locked', COALESCE((SELECT id::text FROM locked), ''), true)`
      })
      const results = await sql.transaction([
        ...locks,
        sql`SELECT profile_id FROM account_approver_state WHERE account_id = ${accountId}::uuid AND profile_id = ${input.profileId}::uuid FOR UPDATE`,
        sql`
        WITH administrator AS MATERIALIZED (
          SELECT id, display_name FROM profiles WHERE id = ${actorId}::uuid AND is_admin IS TRUE
            AND id::text = current_setting('aiso.approval_actor_locked', true)
        ), member AS MATERIALIZED (
          SELECT id FROM profiles WHERE id = ${input.profileId}::uuid AND account_id = ${accountId}::uuid
            AND id::text = current_setting('aiso.approval_target_locked', true)
        ), replay AS MATERIALIZED (
          SELECT e.* FROM account_approver_events e WHERE e.account_id = ${accountId}::uuid
            AND e.administrator_id = ${actorId}::uuid AND e.request_id = ${input.requestId}::uuid
            AND EXISTS (SELECT 1 FROM administrator) AND EXISTS (SELECT 1 FROM member)
        ), current_state AS MATERIALIZED (
          SELECT s.*, e.action AS event_action FROM account_approver_state s
          JOIN account_approver_events e ON e.account_id = s.account_id AND e.profile_id = s.profile_id AND e.new_revision = s.revision AND e.id = s.last_event_id
          WHERE s.account_id = ${accountId}::uuid AND s.profile_id = ${input.profileId}::uuid
        ), eligible AS MATERIALIZED (
          SELECT a.id, a.display_name FROM administrator a CROSS JOIN member
          WHERE NOT EXISTS (SELECT 1 FROM replay)
          AND (
            (${input.expectedRevision} = 0 AND ${input.action} = 'grant' AND NOT EXISTS (
              SELECT 1 FROM account_approver_state WHERE account_id = ${accountId}::uuid AND profile_id = ${input.profileId}::uuid))
            OR EXISTS (SELECT 1 FROM current_state WHERE revision = ${input.expectedRevision}
              AND active = (${input.action} = 'revoke') AND event_action = CASE WHEN active THEN 'grant' ELSE 'revoke' END)
          )
        ), inserted_event AS (
          INSERT INTO account_approver_events (account_id, profile_id, action, previous_revision, new_revision, administrator_id, administrator, reason, request_id)
          SELECT ${accountId}::uuid, ${input.profileId}::uuid, ${input.action}, ${input.expectedRevision}, ${input.expectedRevision} + 1, id,
            jsonb_build_object('profileId', id, 'displayName', display_name, 'role', 'platform_admin'), ${input.reason}, ${input.requestId}::uuid
          FROM eligible RETURNING *
        ), changed_state AS (
          INSERT INTO account_approver_state (account_id, profile_id, active, revision, last_event_id, updated_at)
          SELECT account_id, profile_id, action = 'grant', new_revision, id, now() FROM inserted_event
          ON CONFLICT (account_id, profile_id) DO UPDATE SET active = EXCLUDED.active, revision = EXCLUDED.revision, last_event_id = EXCLUDED.last_event_id, updated_at = now()
          WHERE account_approver_state.revision = ${input.expectedRevision}
            AND account_approver_state.active = (${input.action} = 'revoke')
            AND EXISTS (SELECT 1 FROM administrator) AND EXISTS (SELECT 1 FROM member)
          RETURNING last_event_id
        ), rollback_guard AS MATERIALIZED (
          -- An unexpected empty CAS must abort, never commit a standalone audit event.
          SELECT 1 / CASE WHEN (SELECT count(*) FROM inserted_event) = (SELECT count(*) FROM changed_state) THEN 1 ELSE 0 END AS ok
        ), chosen AS (
          SELECT * FROM inserted_event UNION ALL
          SELECT * FROM replay WHERE profile_id = ${input.profileId}::uuid AND action = ${input.action}
            AND reason = ${input.reason} AND previous_revision = ${input.expectedRevision}
        )
        SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM administrator) THEN 'denied'
          WHEN NOT EXISTS (SELECT 1 FROM member) THEN 'not_found'
          WHEN EXISTS (SELECT 1 FROM inserted_event) THEN 'created'
          WHEN EXISTS (SELECT 1 FROM chosen) THEN 'replayed' ELSE 'conflict' END AS kind,
          (SELECT jsonb_build_object('id', id, 'profileId', profile_id, 'action', action,
            'previousRevision', previous_revision, 'newRevision', new_revision, 'administrator', administrator,
            'reason', reason, 'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) FROM chosen LIMIT 1) AS value,
          rollback_guard.ok FROM rollback_guard`
      ], { isolationLevel: 'ReadCommitted' })
      const row = results.at(-1)?.[0]
      if (!row) return { kind: 'conflict' }
      if (row.kind === 'created' || row.kind === 'replayed') return { kind: row.kind, value: row.value as AccessEventDTO }
      if (row.kind === 'denied' || row.kind === 'not_found') return { kind: row.kind }
      return { kind: 'conflict' }
    } catch (error) {
      const code = (error as { code?: string })?.code
      if ((code === '40001' || code === '40P01') && attempt < 2) continue
      if (code === '23505') return { kind: 'conflict' }
      throw new Error('APPROVAL_UNAVAILABLE')
    }
  }
}
