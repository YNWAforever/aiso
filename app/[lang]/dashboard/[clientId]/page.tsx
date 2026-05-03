import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { SovChart }        from '@/components/pulse/SovChart'
import { PlatformBar }     from '@/components/pulse/PlatformBar'
import { MissedTable }     from '@/components/pulse/MissedTable'
import { CompetitorTab }   from '@/components/pulse/CompetitorTab'
import { AlertsTab }       from '@/components/pulse/AlertsTab'
import { TopBar }          from '@/components/dashboard/TopBar'
import { PulseTabs }       from '@/components/dashboard/PulseTabs'
import { ScanSummary }     from '@/components/dashboard/ScanSummary'
import { AgentSection }    from '@/components/dashboard/AgentSection'
import { AgentRecommendations } from '@/components/dashboard/AgentRecommendations'
import { AgentProgress }         from '@/components/dashboard/AgentProgress'
import { AgentCompetitors }      from '@/components/dashboard/AgentCompetitors'
import {
  Scan, AgentRecommendation, AgentProgress as AgentProgressType,
  AgentCompetitor, PulseWeeklySummary, PulseMetric,
} from '@/lib/types'
import Link from 'next/link'

export default async function DashboardPulsePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { lang, clientId } = await params
  const { tab = 'overview' } = await searchParams
  const profile  = await requireAuth(lang)
  const supabase = await createServerSupabaseClient()

  const { data: client } = await supabase
    .from('clients').select('brand_name')
    .eq('id', clientId).eq('account_id', profile.account_id).single()

  if (!client) notFound()

  // Phase 1: fetch scan + pulse data in parallel
  const [
    { data: latestScan },
    { data: scanHistory },
    { data: pulseSummary },
    { data: pulseMetrics },
  ] = await Promise.all([
    supabase.from('scans').select('*')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false }).limit(1).single(),
    supabase.from('scans').select('id,domain,score,grade,created_at')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('pulse_weekly_summary').select('*')
      .eq('client_id', clientId).order('scan_week').limit(40),
    supabase.from('pulse_metrics')
      .select('platform,question,competitors_mentioned,scan_week')
      .eq('client_id', clientId).eq('brand_mentioned', false)
      .order('scan_week', { ascending: false }).limit(50),
  ])

  const scan = latestScan as Scan | null

  // Phase 2: fetch agent data conditionally (only if a scan exists)
  const [{ data: agentRecs }, { data: agentProg }, { data: agentComps }] = scan
    ? await Promise.all([
        supabase.from('agent_recommendations').select('*').eq('scan_id', scan.id).order('priority').order('impact_score', { ascending: false }),
        supabase.from('agent_progress').select('*').eq('scan_id', scan.id),
        supabase.from('agent_competitors').select('*').eq('scan_id', scan.id).order('mention_rate', { ascending: false }),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  const summary = (pulseSummary ?? []) as PulseWeeklySummary[]
  const missed  = (pulseMetrics ?? []) as PulseMetric[]
  const latestWeek    = summary.filter(d => !d.platform).at(-1)?.scan_week
  const kpi           = summary.find(d => d.scan_week === latestWeek && !d.platform)
  const platformCount = [...new Set(
    summary.filter(d => d.scan_week === latestWeek && d.platform).map(d => d.platform)
  )].length

  return (
    <>
      <TopBar
        title={client.brand_name}
        subtitle={kpi?.scan_week ? `Week of ${kpi.scan_week}` : 'No data yet'}
      />
      <Suspense fallback={null}>
        <PulseTabs />
      </Suspense>

      <main className="flex-1 px-6 py-8 max-w-3xl space-y-6">

        {tab === 'overview' && (
          <>
            {/* KPI Strip */}
            <div className="grid grid-cols-3 gap-4">
              {/* AISO Score */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
                <p className="text-2xl font-black text-blue-600">
                  {scan ? `${scan.score}` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-1">AISO Score</p>
                {scan?.grade && (
                  <span className="inline-block mt-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                    {scan.grade}
                  </span>
                )}
              </div>

              {/* Share of Voice */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
                <p className="text-2xl font-black text-purple-600">
                  {kpi ? `${kpi.sov_score}%` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Share of Voice</p>
              </div>

              {/* Agent Status */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
                <p className="text-2xl font-black text-slate-600">
                  {scan?.agent_status === 'complete' ? '✓' :
                   scan?.agent_status === 'pending' || scan?.agent_status === 'running' ? '...' : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {scan?.agent_status === 'complete' ? 'Agents Ready' :
                   scan?.agent_status === 'pending' || scan?.agent_status === 'running' ? 'Analyzing' : 'No Analysis'}
                </p>
              </div>
            </div>

            {/* Scan Summary or Empty State */}
            {scan ? (
              <ScanSummary scan={scan} />
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
                <p className="text-sm font-semibold text-slate-700 mb-1">No scans yet</p>
                <p className="text-xs text-slate-400 mb-4">Run your first scan to see your AISO score and get agent recommendations.</p>
                <Link
                  href={`/${lang}`}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  Run a Scan
                </Link>
              </div>
            )}

            {/* Agent Results */}
            {scan && (
              <AgentSection status={scan.agent_status}>
                <div className="grid grid-cols-1 gap-4">
                  <AgentRecommendations recommendations={(agentRecs ?? []) as AgentRecommendation[]} />
                  <AgentProgress progress={(agentProg ?? []) as AgentProgressType[]} />
                  <AgentCompetitors competitors={(agentComps ?? []) as AgentCompetitor[]} />
                </div>
              </AgentSection>
            )}

            {/* Pulse Section (compacted) */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-sm font-semibold text-slate-700 mb-3">SoV Trend</p>
              <SovChart data={summary} />
            </div>

            {/* Top Missed Opportunities */}
            {missed.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <p className="text-sm font-semibold text-slate-700 mb-3">Top Missed Opportunities</p>
                <MissedTable
                  rows={missed.slice(0, 3)}
                  platformLabel="Platform"
                  questionLabel="Question"
                  competitorsLabel="Competitors"
                />
              </div>
            )}
          </>
        )}

        {tab === 'platforms' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-4">Platform Breakdown</p>
            <PlatformBar data={summary} />
          </div>
        )}

        {tab === 'missed' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-1">Missed Opportunities</p>
            <p className="text-xs text-slate-400 mb-4">Queries where your brand was not mentioned</p>
            <MissedTable rows={missed} platformLabel="Platform" questionLabel="Question" competitorsLabel="Competitors" />
          </div>
        )}

        {tab === 'competitors' && (
          <CompetitorTab summary={summary} brandName={client.brand_name} />
        )}

        {tab === 'alerts' && (
          <AlertsTab clientId={clientId} />
        )}

      </main>
    </>
  )
}
