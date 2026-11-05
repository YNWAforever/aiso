import 'server-only'
import { db } from '@/lib/db'
import { retryWrite, versionDTO, versionLocks } from '@/lib/change-sets/store'
import type { EditSpecDomainPin } from './domain'
import type { VersionDetail } from '@/lib/change-sets/types'
import { SITE_EDIT_CAP_TIME_ZONE, SITE_EDIT_MONTHLY_SENDS_PER_BRAND, type HandoffEvent } from './handoff'

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
  | { kind: 'ok'; version: VersionDetail; latestId: string; clientName: string; job: { id: string } | null; events: HandoffEvent[]
      receipt: { status: 'completed' | 'rejected'; completedAt: string } | null
      liveCheck: LiveCheckView | null
      /** S8 cap: other jobs of this brand counted this month, and whether this job already counts. */
      monthSends: { others: number; selfCounted: boolean } }

/** S4: the newest live-page check of this job. `attested` = it wrote the verified attestation. */
export type LiveCheckView = { outcome: 'found' | 'missing' | 'fetch_failed'; checkedAt: string; attested: boolean
  /** S7: the scan's structured-data check (c4) on the same fetched page; null when not run. */
  structuredData: 'pass' | 'warn' | 'fail' | null }

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

function receiptRow(value: unknown): { status: 'completed' | 'rejected'; completedAt: string } | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  if (r.status !== 'completed' && r.status !== 'rejected') throw new Error('bad receipt')
  return { status: r.status, completedAt: String(r.completed_at) }
}

function liveCheckRow(value: unknown): LiveCheckView | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  if (r.outcome !== 'found' && r.outcome !== 'missing' && r.outcome !== 'fetch_failed') throw new Error('bad live check')
  const sd = r.structured_data
  if (sd !== null && sd !== undefined && sd !== 'pass' && sd !== 'warn' && sd !== 'fail') throw new Error('bad live check')
  return { outcome: r.outcome, checkedAt: String(r.checked_at), attested: r.attested === true, structuredData: sd ?? null }
}

export async function readHandoff(scope: HandoffScope, now: Date = new Date()): Promise<HandoffRead> {
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
    ), counted AS MATERIALIZED (
      -- S8 cap: this brand's jobs that count as a send this month (Hong Kong time).
      SELECT DISTINCT j2.id FROM site_edit_jobs j2
      JOIN site_edit_job_events e2 ON e2.job_id = j2.id AND e2.account_id = j2.account_id
      WHERE j2.account_id = ${accountId}::uuid AND j2.client_id = ${clientId}::uuid AND EXISTS (SELECT 1 FROM owned)
        AND e2.created_at >= (date_trunc('month', ${now.toISOString()}::timestamptz AT TIME ZONE ${SITE_EDIT_CAP_TIME_ZONE}::text) AT TIME ZONE ${SITE_EDIT_CAP_TIME_ZONE}::text)
        AND (e2.kind IN ('sent', 'unknown') OR (e2.kind = 'claim'
          AND e2.seq = (SELECT max(e3.seq) FROM site_edit_job_events e3 WHERE e3.job_id = j2.id AND e3.account_id = j2.account_id)))
    )
    SELECT EXISTS (SELECT 1 FROM member) AS member, EXISTS (SELECT 1 FROM owned) AS owned,
      (SELECT brand_name FROM owned) AS brand_name,
      (SELECT to_jsonb(v) FROM version v) AS version, (SELECT id FROM latest) AS latest_id,
      (SELECT id FROM job) AS job_id,
      (SELECT count(*)::int FROM counted c WHERE c.id NOT IN (SELECT id FROM job)) AS month_others,
      EXISTS (SELECT 1 FROM counted c JOIN job j ON c.id = j.id) AS month_self,
      (SELECT jsonb_build_object('status', r.status, 'completed_at', to_char(r.completed_at AT TIME ZONE 'UTC', ${ISO}))
        FROM site_edit_receipts r JOIN job j ON r.job_id = j.id AND r.account_id = ${accountId}::uuid) AS receipt,
      (SELECT jsonb_build_object('outcome', c.outcome, 'checked_at', to_char(c.checked_at AT TIME ZONE 'UTC', ${ISO}),
        'attested', c.attestation_id IS NOT NULL, 'structured_data', c.structured_data_status)
        FROM site_edit_live_checks c JOIN job j ON c.job_id = j.id AND c.account_id = ${accountId}::uuid
        ORDER BY c.checked_at DESC, c.recorded_at DESC LIMIT 1) AS live_check,
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
      receipt: receiptRow(row.receipt),
      liveCheck: liveCheckRow(row.live_check),
      monthSends: { others: Number(row.month_others ?? 0), selfCounted: row.month_self === true },
    }
  } catch { return { kind: 'invalid' } }
}

export type ClaimResult = { kind: 'claimed'; jobId: string; seq: number } | { kind: 'ineligible' } | { kind: 'busy' } | { kind: 'capped' }

/**
 * Create the version's job if needed and append a claim, in ONE statement run
 * under the same item/actor locks version submission takes (versionLocks), so
 * a newer version cannot be submitted between the check and the claim. The
 * statement re-establishes, at write time: the actor is a still-active member;
 * the version is the LATEST, approved for exactly `contentHash`; the brand's
 * domain and its verification still equal the pin the caller checked (so a
 * repoint since the check refuses the send); and the job's newest event allows
 * a send (none, failed, unknown, or a claim older than `staleBefore`). Two
 * concurrent claims compute the same next seq; unique (job_id, seq) admits one.
 */
export async function claimHandoff(scope: HandoffScope, contentHash: string, staleBefore: Date, pin: EditSpecDomainPin,
  now: Date = new Date()): Promise<ClaimResult> {
  const { accountId, clientId, itemId, versionId, actorId } = scope
  const result = await retryWrite(async () => {
    const sql = db()
    const results = await sql.transaction([
      ...versionLocks(sql, accountId, clientId, itemId, actorId),
      // The job's row lock, shared with recordReceipt: the claim below runs in a
      // later statement (fresh READ COMMITTED snapshot), so it sees any receipt
      // committed before this lock was granted.
      sql`SELECT id FROM site_edit_jobs WHERE account_id = ${accountId}::uuid AND version_id = ${versionId}::uuid FOR UPDATE`,
      // S8 cap: one brand's claims serialise here, so two sends for different
      // versions of the same brand cannot both see room for the tenth.
      sql`SELECT pg_advisory_xact_lock(9208, hashtext(${clientId}::text))`,
      sql`
        WITH member AS MATERIALIZED (
          SELECT p.id FROM profiles p WHERE p.id = ${actorId}::uuid AND p.account_id = ${accountId}::uuid AND p.deactivated_at IS NULL
            AND p.id::text = current_setting('aiso.version_actor_locked', true)
        ), version AS MATERIALIZED (
          SELECT v.id, v.client_id, v.work_item_id, v.content_hash FROM work_item_versions v
          JOIN work_item_decisions r ON r.account_id = v.account_id AND r.client_id = v.client_id AND r.work_item_id = v.work_item_id
            AND r.version_id = v.id AND r.content_hash = v.content_hash AND r.decision = 'approved'
          WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid AND v.work_item_id = ${itemId}::uuid
            AND v.id = ${versionId}::uuid AND v.content_hash = ${contentHash} AND EXISTS (SELECT 1 FROM member)
            AND v.work_item_id::text = current_setting('aiso.version_item_locked', true)
            AND v.version_number = (SELECT max(version_number) FROM work_item_versions WHERE account_id = ${accountId}::uuid
              AND client_id = ${clientId}::uuid AND work_item_id = ${itemId}::uuid)
            AND EXISTS (SELECT 1 FROM clients c JOIN client_domain_verifications d ON d.client_id = c.id AND d.account_id = c.account_id
              WHERE c.id = v.client_id AND c.account_id = ${accountId}::uuid AND d.verified_at IS NOT NULL
                AND c.domain = ${pin.clientDomain}::text AND d.domain = ${pin.verifiedDomain}::text)
        ), existing AS MATERIALIZED (
          SELECT j.id FROM site_edit_jobs j JOIN version v ON j.account_id = ${accountId}::uuid AND j.version_id = v.id
            AND j.content_hash = v.content_hash
        ), counted AS MATERIALIZED (
          SELECT DISTINCT j2.id FROM site_edit_jobs j2
          JOIN site_edit_job_events e2 ON e2.job_id = j2.id AND e2.account_id = j2.account_id
          WHERE j2.account_id = ${accountId}::uuid AND j2.client_id = ${clientId}::uuid
            AND e2.created_at >= (date_trunc('month', ${now.toISOString()}::timestamptz AT TIME ZONE ${SITE_EDIT_CAP_TIME_ZONE}::text) AT TIME ZONE ${SITE_EDIT_CAP_TIME_ZONE}::text)
            AND (e2.kind IN ('sent', 'unknown') OR (e2.kind = 'claim'
              AND e2.seq = (SELECT max(e3.seq) FROM site_edit_job_events e3 WHERE e3.job_id = j2.id AND e3.account_id = j2.account_id)))
        ), cap AS MATERIALIZED (
          SELECT EXISTS (SELECT 1 FROM counted c JOIN existing x ON c.id = x.id)
            OR (SELECT count(*) FROM counted c WHERE c.id NOT IN (SELECT id FROM existing)) < ${SITE_EDIT_MONTHLY_SENDS_PER_BRAND}::int AS room
        ), inserted AS (
          INSERT INTO site_edit_jobs (account_id, client_id, work_item_id, version_id, content_hash, created_by)
          SELECT ${accountId}::uuid, v.client_id, v.work_item_id, v.id, v.content_hash, ${actorId}::uuid FROM version v
          WHERE NOT EXISTS (SELECT 1 FROM existing) AND (SELECT room FROM cap)
          RETURNING id
        ), job AS (
          SELECT id FROM existing UNION ALL SELECT id FROM inserted
        ), last AS (
          SELECT e.seq, e.kind, e.created_at FROM site_edit_job_events e JOIN existing j ON e.job_id = j.id
          WHERE e.account_id = ${accountId}::uuid ORDER BY e.seq DESC LIMIT 1
        ), claimed AS (
          INSERT INTO site_edit_job_events (job_id, account_id, seq, kind, actor_id)
          SELECT j.id, ${accountId}::uuid, COALESCE((SELECT seq FROM last), 0) + 1, 'claim', m.id FROM job j CROSS JOIN member m
          WHERE NOT EXISTS (SELECT 1 FROM last WHERE kind = 'sent'
            OR (kind = 'claim' AND created_at > ${staleBefore.toISOString()}::timestamptz))
            -- A receipt closes the job: nothing is sent again after one, whatever the events say.
            AND NOT EXISTS (SELECT 1 FROM site_edit_receipts r JOIN existing j ON r.job_id = j.id AND r.account_id = ${accountId}::uuid)
            AND (SELECT room FROM cap)
          RETURNING job_id, seq
        )
        SELECT EXISTS (SELECT 1 FROM version) AS eligible, (SELECT room FROM cap) AS room,
          (SELECT job_id FROM claimed) AS job_id, (SELECT seq FROM claimed) AS seq`,
    ], { isolationLevel: 'ReadCommitted' })
    return results.at(-1)?.[0] as Record<string, unknown> | undefined
  })
  // A concurrent claim took this seq (or this job) first.
  if (result && 'kind' in result && result.kind === 'conflict') return { kind: 'busy' }
  const row = result as Record<string, unknown> | undefined
  if (!row || row.eligible !== true) return { kind: 'ineligible' }
  if (row.room !== true) return { kind: 'capped' }
  if (!row.job_id) return { kind: 'busy' }
  return { kind: 'claimed', jobId: String(row.job_id), seq: Number(row.seq) }
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
