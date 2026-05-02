import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { ClientOverview, Scan, AgentRecommendation, AgentProgress, AgentCompetitor, PulseWeeklySummary, PulseMetric } from '@/lib/types'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServerSupabaseClient()

  // Fetch client + latest scan in parallel
  const [{ data: client }, { data: latestScan }] = await Promise.all([
    supabase.from('clients').select('brand_name')
      .eq('id', clientId).eq('account_id', profile.account_id).single(),
    supabase.from('scans').select('*')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false }).limit(1).single(),
  ])

  if (!client) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const scanId = (latestScan as Scan | null)?.id ?? null

  // Fetch remaining data in parallel
  const [
    { data: scanHistory },
    { data: recommendations },
    { data: progress },
    { data: competitors },
    { data: pulseSummary },
    { data: pulseMetrics },
  ] = await Promise.all([
    supabase.from('scans').select('id,domain,score,grade,created_at')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false }).limit(10),
    scanId
      ? supabase.from('agent_recommendations').select('*')
          .eq('scan_id', scanId).order('priority').order('impact_score', { ascending: false })
      : Promise.resolve({ data: null, error: null }),
    scanId
      ? supabase.from('agent_progress').select('*').eq('scan_id', scanId)
      : Promise.resolve({ data: null, error: null }),
    scanId
      ? supabase.from('agent_competitors').select('*')
          .eq('scan_id', scanId).order('mention_rate', { ascending: false })
      : Promise.resolve({ data: null, error: null }),
    supabase.from('pulse_weekly_summary').select('*')
      .eq('client_id', clientId).order('scan_week').limit(40),
    supabase.from('pulse_metrics')
      .select('platform,question,competitors_mentioned,scan_week')
      .eq('client_id', clientId).eq('brand_mentioned', false)
      .order('scan_week', { ascending: false }).limit(10),
  ])

  const summary = (pulseSummary ?? []) as PulseWeeklySummary[]
  const latestWeek = summary.filter(d => !d.platform).at(-1)?.scan_week
  const kpiRow = summary.find(d => d.scan_week === latestWeek && !d.platform)
  const platformCount = [...new Set(
    summary.filter(d => d.scan_week === latestWeek && d.platform).map(d => d.platform)
  )].length

  const overview: ClientOverview = {
    client: { brand_name: client.brand_name },
    latestScan: latestScan as Scan | null,
    scanHistory: (scanHistory ?? []) as Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[],
    recommendations: (recommendations ?? []) as AgentRecommendation[],
    progress: (progress ?? []) as AgentProgress[],
    competitors: (competitors ?? []) as AgentCompetitor[],
    pulseSummary: summary,
    pulseKpi: kpiRow ? {
      sovScore: kpiRow.sov_score,
      brandMentions: kpiRow.brand_mentions,
      totalQueries: kpiRow.total_queries,
      platformCount,
      scanWeek: kpiRow.scan_week,
    } : null,
    missedOpportunities: ((pulseMetrics ?? []) as PulseMetric[]).map(m => ({
      platform: m.platform,
      question: m.question,
      competitors_mentioned: m.competitors_mentioned,
      scan_week: m.scan_week,
    })),
  }

  return NextResponse.json(overview)
}
