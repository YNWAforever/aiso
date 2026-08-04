import { db } from '@/lib/db'
import type {
  AgentCompetitor,
  Client,
  LocalTrustAction,
  LocalTrustActionStatus,
  LocalTrustProfile,
  LocalTrustSnapshot,
  PulseMetric,
  PulseWeeklySummary,
  Scan,
} from '@/lib/types'
import { calculateLocalTrust } from './scoring'
import type { LocalTrustSnapshotDraft } from './types'

// Neon throws on a failed query where supabase-js resolved { data, error } —
// every query in this module runs through here so a thrown query becomes a
// plain Error the caller can catch, instead of an empty/`null` result that
// would be indistinguishable from "no row".
async function runQuery<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query()
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}

export async function verifyClientOwnership(clientId: string, accountId: string): Promise<Client | null> {
  const sql = db()
  const rows = await runQuery(() => sql`
    select * from clients
    where id = ${clientId} and account_id = ${accountId}
    limit 1
  `)
  return (rows[0] ?? null) as Client | null
}

export async function getLocalTrustProfile(clientId: string, accountId: string): Promise<LocalTrustProfile | null> {
  const sql = db()
  const rows = await runQuery(() => sql`
    select * from local_trust_profiles
    where client_id = ${clientId} and account_id = ${accountId}
    limit 1
  `)
  return (rows[0] ?? null) as LocalTrustProfile | null
}

export async function upsertLocalTrustProfile(input: {
  clientId: string
  accountId: string
  primaryServices: string[]
  serviceArea: string | null
  averageLeadValue: number | null
  closeRate: number | null
  competitors: string[]
}): Promise<LocalTrustProfile> {
  const sql = db()
  // client_id is unique on this table, and local_trust_profiles carries a
  // composite FK (client_id, account_id) -> clients(id, account_id) — an
  // accountId that does not actually own clientId fails the insert/update at
  // the database level, so this can't be used to take over another
  // account's profile even without an extra WHERE on the conflict path.
  const rows = await runQuery(() => sql`
    insert into local_trust_profiles (
      client_id, account_id, primary_services, service_area,
      average_lead_value, close_rate, competitors, updated_at
    ) values (
      ${input.clientId}, ${input.accountId}, ${input.primaryServices}, ${input.serviceArea},
      ${input.averageLeadValue}, ${input.closeRate}, ${input.competitors}, now()
    )
    on conflict (client_id) do update set
      account_id         = excluded.account_id,
      primary_services    = excluded.primary_services,
      service_area        = excluded.service_area,
      average_lead_value  = excluded.average_lead_value,
      close_rate           = excluded.close_rate,
      competitors          = excluded.competitors,
      updated_at           = excluded.updated_at
    returning *
  `)
  const row = rows[0]
  if (!row) throw new Error('local_trust_profiles upsert returned no row')
  return row as LocalTrustProfile
}

// NOTE on scoping: this function's exported signature (clientId + actionId,
// no accountId) predates this migration and callers depend on it — the sole
// caller today is the fenced PATCH route in
// app/api/dashboard/clients/[clientId]/local-trust/actions/[actionId]/route.ts,
// which returns 503 before ever reaching this code. local_trust_actions also
// carries no account_id column of its own (only client_id + snapshot_id), so
// there is no account_id value available here to filter on even if the
// signature were changed. Tenant safety for this table is therefore enforced
// one layer up: local_trust_actions(snapshot_id, client_id) FKs to
// local_trust_snapshots(id, client_id), and every snapshot is written by
// getOrCreateLocalTrustSnapshot below with an account-verified accountId. If
// this route is ever unfenced, add an accountId parameter here and join
// through local_trust_snapshots to check it before restoring live traffic.
export async function updateLocalTrustActionStatus(input: {
  clientId: string
  actionId: string
  status: LocalTrustActionStatus
}): Promise<LocalTrustAction | null> {
  const sql = db()
  const rows = await runQuery(() => sql`
    update local_trust_actions
    set status = ${input.status}, updated_at = now()
    where id = ${input.actionId} and client_id = ${input.clientId}
    returning *
  `)
  return (rows[0] ?? null) as LocalTrustAction | null
}

export async function getOrCreateLocalTrustSnapshot(input: {
  client: Client
  accountId: string
  latestScan: Scan | null
  profile: LocalTrustProfile | null
  pulseSummary: PulseWeeklySummary[]
  missed: PulseMetric[]
  competitors: AgentCompetitor[]
}): Promise<{ snapshot: LocalTrustSnapshot; actions: LocalTrustAction[]; draft: LocalTrustSnapshotDraft }> {
  const sql = db()
  const draft = calculateLocalTrust({
    accountId: input.accountId,
    client: input.client,
    profile: input.profile,
    scan: input.latestScan,
    pulseSummary: input.pulseSummary,
    missed: input.missed,
    competitors: input.competitors,
  })

  const accountId = draft.account_id || input.accountId

  // Same tenant backstop as upsertLocalTrustProfile: local_trust_snapshots
  // carries the composite FK (client_id, account_id) -> clients(id, account_id).
  const snapshotRows = await runQuery(() => sql`
    insert into local_trust_snapshots (
      client_id, account_id, snapshot_month, local_trust_score,
      bucket_scores, trust_gaps, roi_estimate, source_scan_id, source_pulse_week
    ) values (
      ${input.client.id}, ${accountId}, ${draft.snapshot_month}, ${draft.local_trust_score},
      ${JSON.stringify(draft.bucket_scores)}::jsonb, ${JSON.stringify(draft.trust_gaps)}::jsonb,
      ${draft.roi_estimate ? JSON.stringify(draft.roi_estimate) : null}::jsonb,
      ${draft.source_scan_id}, ${draft.source_pulse_week}
    )
    on conflict (client_id, snapshot_month) do update set
      account_id        = excluded.account_id,
      local_trust_score  = excluded.local_trust_score,
      bucket_scores       = excluded.bucket_scores,
      trust_gaps           = excluded.trust_gaps,
      roi_estimate         = excluded.roi_estimate,
      source_scan_id       = excluded.source_scan_id,
      source_pulse_week    = excluded.source_pulse_week
    returning *
  `)

  const savedSnapshot = snapshotRows[0] as LocalTrustSnapshot | undefined
  if (!savedSnapshot) throw new Error('local_trust_snapshots upsert returned no row')

  const actionRows = draft.trust_gaps.map(gap => ({
    client_id: input.client.id,
    snapshot_id: savedSnapshot.id,
    stable_key: gap.stableKey,
    title: gap.title,
    bucket: gap.bucket,
    impact: gap.impact,
    effort: gap.effort,
    status: 'open' as LocalTrustActionStatus,
  }))

  if (actionRows.length > 0) {
    // do nothing on conflict — an action that already exists keeps its
    // status (open/planned/done/skipped); the metadata refresh below still
    // updates its title/bucket/impact/effort.
    await runQuery(() => Promise.all(actionRows.map(row => sql`
      insert into local_trust_actions (
        client_id, snapshot_id, stable_key, title, bucket, impact, effort, status
      ) values (
        ${row.client_id}, ${row.snapshot_id}, ${row.stable_key}, ${row.title},
        ${row.bucket}, ${row.impact}, ${row.effort}, ${row.status}
      )
      on conflict (snapshot_id, stable_key) do nothing
    `)))
  }

  await runQuery(() => Promise.all(draft.trust_gaps.map(gap => sql`
    update local_trust_actions
    set title = ${gap.title}, bucket = ${gap.bucket}, impact = ${gap.impact},
        effort = ${gap.effort}, updated_at = now()
    where snapshot_id = ${savedSnapshot.id} and stable_key = ${gap.stableKey}
  `)))

  const actionsRows = await runQuery(() => sql`
    select * from local_trust_actions
    where snapshot_id = ${savedSnapshot.id}
    order by created_at
  `)

  const metadataByStableKey = new Map(draft.trust_gaps.map(gap => [gap.stableKey, {
    title: gap.title,
    bucket: gap.bucket,
    impact: gap.impact,
    effort: gap.effort,
  }]))
  const currentStableKeys = new Set(metadataByStableKey.keys())
  const currentActions = (actionsRows as unknown as LocalTrustAction[])
    .filter(action => currentStableKeys.has(action.stable_key))
    .map(action => ({ ...action, ...metadataByStableKey.get(action.stable_key) }))

  return {
    snapshot: savedSnapshot,
    actions: currentActions,
    draft,
  }
}
