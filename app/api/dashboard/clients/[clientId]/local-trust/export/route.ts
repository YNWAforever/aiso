import { getProfile } from '@/lib/auth'
import { findNewestMatchingScan } from '@/lib/localTrust'
import { getLocalTrustProfile, getOrCreateLocalTrustSnapshot, verifyClientOwnership } from '@/lib/localTrust/store'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { planAllows } from '@/lib/tier'
import type { AgentCompetitor, PulseMetric, PulseWeeklySummary, Scan } from '@/lib/types'

type QueryError = { message: string; code?: string }

function isNoRowsError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PGRST116')
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  const safeText = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text
  const escaped = safeText.replaceAll('"', '""')
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped
}

function csvRows(rows: Array<[string, unknown]>) {
  return rows.map(row => row.map(csvCell).join(',')).join('\n')
}

function exportFilename(clientId: string) {
  const safeClientId = clientId
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return `local-trust-${safeClientId || 'client'}.csv`
}

function assertNoQueryError(error: QueryError | null | undefined) {
  if (error) throw new Error('Export query failed')
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
    const { data: scanRowsData, error: scanRowsError } = await supabase
      .from('scans')
      .select('*')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false })
      .limit(25)

    if (scanRowsError && !isNoRowsError(scanRowsError)) {
      throw new Error('Export query failed')
    }

    const scanRows = Array.isArray(scanRowsData)
      ? scanRowsData as Scan[]
      : scanRowsData ? [scanRowsData as Scan] : []
    const latestScan = findNewestMatchingScan(scanRows, client.domain)

    const [
      { data: pulseSummary, error: pulseSummaryError },
      { data: missed, error: missedError },
      { data: competitors, error: competitorsError },
    ] = await Promise.all([
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
        : Promise.resolve({ data: [], error: null }),
    ])

    assertNoQueryError(pulseSummaryError)
    assertNoQueryError(missedError)
    assertNoQueryError(competitorsError)

    const summary = (pulseSummary ?? []) as PulseWeeklySummary[]
    const hasAggregatePulseBaseline = summary.some(row => !row.platform)
    if (!latestScan && !hasAggregatePulseBaseline) {
      return Response.json({ error: 'LOCAL_TRUST_BASELINE_REQUIRED' }, { status: 409 })
    }

    const localTrustProfile = await getLocalTrustProfile(clientId, profile.account_id)

    const { snapshot, actions } = await getOrCreateLocalTrustSnapshot({
      client,
      accountId: profile.account_id,
      latestScan,
      profile: localTrustProfile,
      pulseSummary: summary,
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
        'content-disposition': `attachment; filename="${exportFilename(clientId)}"`,
      },
    })
  } catch {
    return Response.json({ error: 'Export failed' }, { status: 500 })
  }
}
