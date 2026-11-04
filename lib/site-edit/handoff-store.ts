import 'server-only'
import { db } from '@/lib/db'
import { versionDTO } from '@/lib/change-sets/store'
import type { VersionDetail } from '@/lib/change-sets/types'
import type { HandoffEvent } from './handoff'

/**
 * Site-edit S2 store (migration 089). Every statement is scoped by the
 * caller's account, and membership + ownership (account → client → item →
 * version) are resolved inside the same statement as the read or write, so
 * nothing here trusts an id the caller supplied.
 */

export type HandoffScope = { accountId: string; clientId: string; itemId: string; versionId: string; actorId: string }

export type HandoffRead =
  | { kind: 'denied' }
  | { kind: 'not_found' }
  | { kind: 'invalid' }
  | { kind: 'ok'; version: VersionDetail; latestId: string; clientName: string; job: { id: string } | null; events: HandoffEvent[] }

const ISO = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

function eventRow(value: unknown): HandoffEvent {
  const e = value as Record<string, unknown>
  const kind = e.kind
  if (kind !== 'claim' && kind !== 'sent' && kind !== 'failed' && kind !== 'unknown') throw new Error('bad event')
  return {
    seq: Number(e.seq), kind, at: String(e.created_at),
    executorStatus: e.executor_status === null || e.executor_status === undefined ? null : Number(e.executor_status),
    executorRef: typeof e.executor_ref === 'string' ? e.executor_ref : null,
  }
}

export async function readHandoff(scope: HandoffScope): Promise<HandoffRead> {
  const { accountId, clientId, itemId, versionId, actorId } = scope
  const [row] = await db()`
    WITH member AS MATERIALIZED (
      SELECT p.id FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid AND p.deactivated_at IS NULL
    ), owned AS MATERIALIZED (
      SELECT d.id, c.brand_name FROM evidence_work_items d JOIN clients c ON c.id = d.client_id AND c.account_id = d.account_id
      WHERE d.account_id = ${accountId}::uuid AND d.client_id = ${clientId}::uuid AND d.id = ${itemId}::uuid
        AND EXISTS (SELECT 1 FROM member)
    ), version AS MATERIALIZED (
      SELECT v.*, to_jsonb(r) AS decision_record, false AS can_decide FROM work_item_versions v
      LEFT JOIN work_item_decisions r ON r.account_id = v.account_id AND r.client_id = v.client_id
        AND r.work_item_id = v.work_item_id AND r.version_id = v.id AND r.content_hash = v.content_hash
      WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid AND v.work_item_id = ${itemId}::uuid
        AND v.id = ${versionId}::uuid AND EXISTS (SELECT 1 FROM owned)
    ), latest AS MATERIALIZED (
      SELECT id FROM work_item_versions WHERE account_id = ${accountId}::uuid AND client_id = ${clientId}::uuid
        AND work_item_id = ${itemId}::uuid AND EXISTS (SELECT 1 FROM owned) ORDER BY version_number DESC LIMIT 1
    ), job AS MATERIALIZED (
      SELECT j.id FROM site_edit_jobs j JOIN version v ON j.account_id = v.account_id AND j.version_id = v.id
        AND j.content_hash = v.content_hash
    )
    SELECT EXISTS (SELECT 1 FROM member) AS member, EXISTS (SELECT 1 FROM owned) AS owned,
      (SELECT brand_name FROM owned) AS brand_name,
      (SELECT to_jsonb(v) FROM version v) AS version, (SELECT id FROM latest) AS latest_id,
      (SELECT id FROM job) AS job_id,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('seq', e.seq, 'kind', e.kind, 'executor_status', e.executor_status,
        'executor_ref', e.executor_ref, 'created_at', to_char(e.created_at AT TIME ZONE 'UTC', ${ISO})) ORDER BY e.seq)
        FROM site_edit_job_events e JOIN job j ON e.job_id = j.id AND e.account_id = ${accountId}::uuid), '[]'::jsonb) AS events`
  if (!row) throw new Error('HANDOFF_UNAVAILABLE')
  if (row.member !== true) return { kind: 'denied' }
  if (row.owned !== true || !row.version) return { kind: 'not_found' }
  try {
    return {
      kind: 'ok',
      version: versionDTO(row.version as Record<string, unknown>),
      latestId: String(row.latest_id),
      clientName: String(row.brand_name ?? ''),
      job: row.job_id ? { id: String(row.job_id) } : null,
      events: (row.events as unknown[]).map(eventRow),
    }
  } catch { return { kind: 'invalid' } }
}

export type ClaimResult = { kind: 'claimed'; jobId: string; seq: number } | { kind: 'ineligible' } | { kind: 'busy' }

/**
 * Create the version's job if needed and append a claim — only if the version
 * is still the latest, still approved for this exact hash, the actor is still
 * an active member, and the job's newest event allows a send (none, failed,
 * unknown, or a claim stale past `staleBefore`). Two concurrent claims compute
 * the same next seq; the unique (job_id, seq) lets exactly one through.
 */
export async function claimHandoff(scope: HandoffScope, contentHash: string, staleBefore: Date): Promise<ClaimResult> {
  const { accountId, clientId, itemId, versionId, actorId } = scope
  const sql = db()
  try {
    const [row] = await sql`
      WITH member AS MATERIALIZED (
        SELECT p.id FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid AND p.deactivated_at IS NULL
      ), version AS MATERIALIZED (
        SELECT v.id, v.client_id, v.work_item_id, v.content_hash FROM work_item_versions v
        JOIN work_item_decisions r ON r.account_id = v.account_id AND r.client_id = v.client_id AND r.work_item_id = v.work_item_id
          AND r.version_id = v.id AND r.content_hash = v.content_hash AND r.decision = 'approved'
        WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid AND v.work_item_id = ${itemId}::uuid
          AND v.id = ${versionId}::uuid AND v.content_hash = ${contentHash} AND EXISTS (SELECT 1 FROM member)
          AND v.version_number = (SELECT max(version_number) FROM work_item_versions WHERE account_id = ${accountId}::uuid
            AND client_id = ${clientId}::uuid AND work_item_id = ${itemId}::uuid)
      ), inserted AS (
        INSERT INTO site_edit_jobs (account_id, client_id, work_item_id, version_id, content_hash, created_by)
        SELECT ${accountId}::uuid, v.client_id, v.work_item_id, v.id, v.content_hash, ${actorId}::uuid FROM version v
        ON CONFLICT (account_id, version_id) DO NOTHING
        RETURNING id
      )
      SELECT (SELECT id FROM inserted) AS inserted_id,
        (SELECT j.id FROM site_edit_jobs j JOIN version v ON j.account_id = ${accountId}::uuid AND j.version_id = v.id
          AND j.content_hash = v.content_hash) AS existing_id`
    const jobId = (row?.inserted_id ?? row?.existing_id) as string | null
    if (!jobId) return { kind: 'ineligible' }
    const [claim] = await sql`
      WITH last AS (
        SELECT seq, kind, created_at FROM site_edit_job_events
        WHERE job_id = ${jobId}::uuid AND account_id = ${accountId}::uuid ORDER BY seq DESC LIMIT 1
      ), member AS (
        SELECT p.id FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid AND p.deactivated_at IS NULL
      )
      INSERT INTO site_edit_job_events (job_id, account_id, seq, kind, actor_id)
      SELECT ${jobId}::uuid, ${accountId}::uuid, COALESCE((SELECT seq FROM last), 0) + 1, 'claim', m.id FROM member m
      WHERE NOT EXISTS (SELECT 1 FROM last WHERE kind = 'sent'
          OR (kind = 'claim' AND created_at > ${staleBefore.toISOString()}::timestamptz))
      RETURNING seq`
    return claim ? { kind: 'claimed', jobId, seq: Number(claim.seq) } : { kind: 'busy' }
  } catch (error) {
    // A concurrent claim took this seq first.
    if ((error as { code?: string })?.code === '23505') return { kind: 'busy' }
    throw error
  }
}

/** Append the call's outcome right after its claim. Throws on any failure: the caller must not report success. */
export async function recordHandoffOutcome(input: { accountId: string; jobId: string; claimSeq: number; actorId: string;
  kind: 'sent' | 'failed' | 'unknown'; status: number | null; ref: string | null }): Promise<void> {
  const rows = await db()`
    INSERT INTO site_edit_job_events (job_id, account_id, seq, kind, actor_id, executor_status, executor_ref)
    SELECT j.id, j.account_id, ${input.claimSeq + 1}, ${input.kind}, ${input.actorId}::uuid, ${input.status}, ${input.ref}
    FROM site_edit_jobs j WHERE j.id = ${input.jobId}::uuid AND j.account_id = ${input.accountId}::uuid
    RETURNING seq`
  if (rows.length !== 1) throw new Error('HANDOFF_OUTCOME_UNRECORDED')
}
