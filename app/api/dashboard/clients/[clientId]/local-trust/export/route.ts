import { getProfile } from '@/lib/auth'
import { getLocalTrustProfile, getOrCreateLocalTrustSnapshot, verifyClientOwnership } from '@/lib/localTrust/store'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { planAllows } from '@/lib/tier'
import type { AgentCompetitor, PulseMetric, PulseWeeklySummary, Scan } from '@/lib/types'

function normalizeDomain(domain: string | null | undefined) {
  const value = domain?.trim().toLowerCase()
  if (!value) return null

  return value
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    ?.split(':')[0] || null
}

function domainsMatch(scanDomain: string | null | undefined, clientDomain: string | null | undefined) {
  const normalizedScan = normalizeDomain(scanDomain)
  const normalizedClient = normalizeDomain(clientDomain)

  return Boolean(normalizedScan && normalizedClient && normalizedScan === normalizedClient)
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  const escaped = text.replaceAll('"', '""')
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped
}

function csvRows(rows: Array<[string, unknown]>) {
  return rows.map(row => row.map(csvCell).join(',')).join('\n')
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const plan = profile.accounts?.plan ?? 'basic'
  if (!planAllows(plan, 'local_trust_export')) {
    return Response.json({ error: 'UPGRADE_REQUIRED', feature: 'local_trust_export', plan }, { status: 403 })
  }

  const client = await verifyClientOwnership(clientId, profile.account_id)
  if (!client) return Response.json({ error: 'Not found' }, { status: 404 })

  try {
    const supabase = await createServerSupabaseClient()
    const { data: latestScanRow } = await supabase
      .from('scans')
      .select('*')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const latestScan = domainsMatch((latestScanRow as Scan | null)?.domain, client.domain)
      ? latestScanRow as Scan
      : null

    const [{ data: pulseSummary }, { data: missed }, { data: competitors }, localTrustProfile] = await Promise.all([
      supabase
        .from('pulse_weekly_summary')
        .select('*')
        .eq('client_id', clientId)
        .order('scan_week')
        .limit(40),
      supabase
        .from('pulse_metrics')
        .select('*')
        .eq('client_id', clientId)
        .eq('brand_mentioned', false)
        .order('scan_week', { ascending: false })
        .limit(50),
      latestScan
        ? supabase
            .from('agent_competitors')
            .select('*')
            .eq('scan_id', latestScan.id)
            .order('mention_rate', { ascending: false })
        : Promise.resolve({ data: [] }),
      getLocalTrustProfile(clientId, profile.account_id),
    ])

    const { snapshot, actions } = await getOrCreateLocalTrustSnapshot({
      client,
      accountId: profile.account_id,
      latestScan,
      profile: localTrustProfile,
      pulseSummary: (pulseSummary ?? []) as PulseWeeklySummary[],
      missed: (missed ?? []) as PulseMetric[],
      competitors: (competitors ?? []) as AgentCompetitor[],
    })

    const topAction = actions.find(action => action.status === 'open') ?? actions[0]
    const csv = csvRows([
      ['Metric', 'Value'],
      ['Local Trust Score', snapshot.local_trust_score],
      ['Snapshot Month', snapshot.snapshot_month],
      ['Top Action', topAction?.title ?? 'No open actions'],
      ['Estimated Value Low', snapshot.roi_estimate?.low ?? ''],
      ['Estimated Value High', snapshot.roi_estimate?.high ?? ''],
    ])

    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="local-trust-${clientId}.csv"`,
      },
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Export failed' }, { status: 500 })
  }
}
