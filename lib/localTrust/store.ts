import { createServerSupabaseClient } from '@/lib/supabase-server'
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

function isNoRowsError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PGRST116')
}

export async function verifyClientOwnership(clientId: string, accountId: string): Promise<Client | null> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .eq('account_id', accountId)
    .single()

  return (data ?? null) as Client | null
}

export async function getLocalTrustProfile(clientId: string, accountId: string): Promise<LocalTrustProfile | null> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('local_trust_profiles')
    .select('*')
    .eq('client_id', clientId)
    .eq('account_id', accountId)
    .single()

  if (error && !isNoRowsError(error)) throw new Error(error.message)
  return (data ?? null) as LocalTrustProfile | null
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
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('local_trust_profiles')
    .upsert({
      client_id: input.clientId,
      account_id: input.accountId,
      primary_services: input.primaryServices,
      service_area: input.serviceArea,
      average_lead_value: input.averageLeadValue,
      close_rate: input.closeRate,
      competitors: input.competitors,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id' })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as LocalTrustProfile
}

export async function updateLocalTrustActionStatus(input: {
  clientId: string
  actionId: string
  status: LocalTrustActionStatus
}): Promise<LocalTrustAction | null> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('local_trust_actions')
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq('id', input.actionId)
    .eq('client_id', input.clientId)
    .select()
    .single()

  if (error && !isNoRowsError(error)) throw new Error(error.message)
  return (data ?? null) as LocalTrustAction | null
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
  const supabase = await createServerSupabaseClient()
  const draft = calculateLocalTrust({
    accountId: input.accountId,
    client: input.client,
    profile: input.profile,
    scan: input.latestScan,
    pulseSummary: input.pulseSummary,
    missed: input.missed,
    competitors: input.competitors,
  })

  const { data: snapshot, error } = await supabase
    .from('local_trust_snapshots')
    .upsert({
      client_id: input.client.id,
      account_id: draft.account_id || input.accountId,
      snapshot_month: draft.snapshot_month,
      local_trust_score: draft.local_trust_score,
      bucket_scores: draft.bucket_scores,
      trust_gaps: draft.trust_gaps,
      roi_estimate: draft.roi_estimate,
      source_scan_id: draft.source_scan_id,
      source_pulse_week: draft.source_pulse_week,
    }, { onConflict: 'client_id,snapshot_month' })
    .select()
    .single()

  if (error) throw new Error(error.message)

  const savedSnapshot = snapshot as LocalTrustSnapshot
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
    const { error: actionError } = await supabase
      .from('local_trust_actions')
      .upsert(actionRows, { onConflict: 'snapshot_id,stable_key', ignoreDuplicates: true })

    if (actionError) throw new Error(actionError.message)
  }

  const { data: actions, error: actionsError } = await supabase
    .from('local_trust_actions')
    .select('*')
    .eq('snapshot_id', savedSnapshot.id)
    .order('created_at')

  if (actionsError) throw new Error(actionsError.message)

  return {
    snapshot: savedSnapshot,
    actions: (actions ?? []) as LocalTrustAction[],
    draft,
  }
}
