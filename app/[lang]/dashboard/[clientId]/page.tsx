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

const stagger = (i: number) => ({ animationDelay: `${i * 80}ms` })

function KPICard({ label, value, accent, badge }: {
  label: string; value: string; accent: string; badge?: React.ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5 text-center animate-fade-up group hover:border-[#2a2a40] transition-colors duration-300">
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `radial-gradient(ellipse at 50% 0%, ${accent}08, transparent 70%)` }} />
      <p className="relative text-[28px] font-bold tracking-tight font-mono" style={{ color: accent }}>
        {value}
      </p>
      <p className="relative text-[11px] text-[#5c5c6e] mt-1.5 tracking-widest uppercase">{label}</p>
      {badge && <div className="relative mt-1.5">{badge}</div>}
    </div>
  )
}

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

  const GRADE_MAP: Record<string, { color: string; bg: string }> = {
    'A+': { color: '#22c55e', bg: '#22c55e18' },
    'A':  { color: '#22c55e', bg: '#22c55e18' },
    'B':  { color: '#a78bfa', bg: '#a78bfa18' },
    'C':  { color: '#f59e0b', bg: '#f59e0b18' },
    'D':  { color: '#f59e0b', bg: '#f59e0b18' },
    'F':  { color: '#ef4444', bg: '#ef444418' },
  }
  const g = scan?.grade ? GRADE_MAP[scan.grade] ?? GRADE_MAP['F'] : null

  return (
    <div className="dashboard-dark min-h-full">
      <TopBar
        title={client.brand_name}
        subtitle={kpi?.scan_week ? `Week of ${kpi.scan_week}` : 'No data yet'}
      />
      <Suspense fallback={null}>
        <PulseTabs />
      </Suspense>

      <main className="flex-1 px-6 py-8 max-w-3xl space-y-5">

        {tab === 'overview' && (
          <>
            {/* ── KPI Strip ── */}
            <div className="grid grid-cols-3 gap-3">
              <KPICard
                label="AISO Score"
                value={scan ? `${scan.score}` : '—'}
                accent="#00d4ff"
                badge={g && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase"
                    style={{ color: g.color, background: g.bg }}>
                    {scan!.grade}
                  </span>
                )}
              />
              <KPICard
                label="Share of Voice"
                value={kpi ? `${kpi.sov_score}%` : '—'}
                accent="#a78bfa"
              />
              <KPICard
                label={
                  scan?.agent_status === 'complete' ? 'Agents Ready' :
                  scan?.agent_status === 'pending' || scan?.agent_status === 'running' ? 'Analyzing' : 'No Analysis'
                }
                value={
                  scan?.agent_status === 'complete' ? '✓' :
                  scan?.agent_status === 'pending' || scan?.agent_status === 'running' ? '···' : '—'
                }
                accent={
                  scan?.agent_status === 'complete' ? '#22c55e' :
                  scan?.agent_status === 'pending' || scan?.agent_status === 'running' ? '#00d4ff' : '#5c5c6e'
                }
              />
            </div>

            {/* ── Scan Summary ── */}
            <div style={stagger(3)} className="animate-fade-up">
              {scan ? (
                <ScanSummary scan={scan} />
              ) : (
                <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-8 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#00d4ff12] mb-4">
                    <svg className="w-5 h-5 text-[#00d4ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-[#e0e0ec] mb-1">No scans yet</p>
                  <p className="text-xs text-[#5c5c6e] mb-5">Run your first scan to see your AISO score and get agent recommendations.</p>
                  <Link href={`/${lang}`}
                    className="inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-lg text-[#050510] bg-[#00d4ff] hover:bg-[#00e5ff] transition-colors">
                    Run a Scan
                  </Link>
                </div>
              )}
            </div>

            {/* ── Agent Results ── */}
            {scan && (
              <div style={stagger(4)} className="animate-fade-up">
                <AgentSection status={scan.agent_status}>
                  <div className="space-y-3">
                    <AgentRecommendations recommendations={(agentRecs ?? []) as AgentRecommendation[]} />
                    <AgentProgress progress={(agentProg ?? []) as AgentProgressType[]} />
                    <AgentCompetitors competitors={(agentComps ?? []) as AgentCompetitor[]} />
                  </div>
                </AgentSection>
              </div>
            )}

            {/* ── Pulse Section ── */}
            <div style={stagger(5)} className="animate-fade-up rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
              <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-4">SoV Trend</p>
              <SovChart data={summary} />
            </div>

            {/* ── Top Missed Opportunities ── */}
            {missed.length > 0 && (
              <div style={stagger(6)} className="animate-fade-up rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
                  <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase">Top Missed Opportunities</p>
                </div>
                <MissedTable
                  rows={missed.slice(0, 3)}
                  platformLabel="Platform"
                  questionLabel="Query"
                  competitorsLabel="Competitors"
                />
              </div>
            )}
          </>
        )}

        {tab !== 'overview' && (
          <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-6">
            {tab === 'platforms' && (
              <>
                <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-4">Platform Breakdown</p>
                <PlatformBar data={summary} />
              </>
            )}
            {tab === 'missed' && (
              <>
                <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-1">Missed Opportunities</p>
                <p className="text-[11px] text-[#3c3c4e] mb-4">Queries where your brand was not mentioned</p>
                <MissedTable rows={missed} platformLabel="Platform" questionLabel="Query" competitorsLabel="Competitors" />
              </>
            )}
            {tab === 'competitors' && (
              <CompetitorTab summary={summary} brandName={client.brand_name} />
            )}
            {tab === 'alerts' && (
              <AlertsTab clientId={clientId} />
            )}
          </div>
        )}

      </main>
    </div>
  )
}
