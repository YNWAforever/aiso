import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { TopBar } from '@/components/dashboard/TopBar'
import { WizardProgress } from '@/components/dashboard/WizardProgress'
import { ScanStep } from '@/components/dashboard/ScanStep'
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import { ImproveStep } from '@/components/dashboard/ImproveStep'
import { MonitorStep } from '@/components/dashboard/MonitorStep'
import {
  Scan, AgentRecommendation, AgentProgress as AgentProgressType,
  AgentCompetitor, PulseWeeklySummary, PulseMetric,
} from '@/lib/types'

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams: Promise<{ step?: string }>
}) {
  const { lang, clientId } = await params
  const { step = 'scan' } = await searchParams
  const profile  = await requireAuth(lang)
  const supabase = await createServerSupabaseClient()
  const plan = profile.accounts?.plan ?? 'basic'

  const { data: client } = await supabase
    .from('clients').select('brand_name')
    .eq('id', clientId).eq('account_id', profile.account_id).single()

  if (!client) notFound()

  // Phase 1: scan + pulse
  const [{ data: latestScan }, { data: scanHistory }, { data: pulseSummary }, { data: pulseMetrics }] =
    await Promise.all([
      supabase.from('scans').select('*').eq('account_id', profile.account_id)
        .order('created_at', { ascending: false }).limit(1).single(),
      supabase.from('scans').select('id,domain,score,grade,created_at')
        .eq('account_id', profile.account_id).order('created_at', { ascending: false }).limit(10),
      supabase.from('pulse_weekly_summary').select('*')
        .eq('client_id', clientId).order('scan_week').limit(40),
      supabase.from('pulse_metrics')
        .select('platform,question,competitors_mentioned,scan_week')
        .eq('client_id', clientId).eq('brand_mentioned', false)
        .order('scan_week', { ascending: false }).limit(50),
    ])

  const scan = latestScan as Scan | null

  // Phase 2: agent data
  const [{ data: agentRecs }, { data: agentProg }, { data: agentComps }] = scan
    ? await Promise.all([
        supabase.from('agent_recommendations').select('*').eq('scan_id', scan.id).order('priority').order('impact_score', { ascending: false }),
        supabase.from('agent_progress').select('*').eq('scan_id', scan.id),
        supabase.from('agent_competitors').select('*').eq('scan_id', scan.id).order('mention_rate', { ascending: false }),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  const summary = (pulseSummary ?? []) as PulseWeeklySummary[]
  const missed  = (pulseMetrics ?? []) as PulseMetric[]
  const kpi = summary.filter(d => !d.platform).at(-1)

  return (
    <div className="dashboard-dark min-h-full">
      <TopBar
        title={client.brand_name}
        subtitle={kpi?.scan_week ? `Week of ${kpi.scan_week}` : 'No data yet'}
      />

      <WizardProgress
        current={step}
        plan={plan}
        hasScan={!!scan}
      />

      <main className="flex-1 px-6 py-6 max-w-3xl mx-auto">
        {step === 'scan' && <ScanStep lang={lang} scan={scan} scanHistory={(scanHistory ?? []) as Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]} />}

        {step === 'results' && scan && <ResultsStep scan={scan} />}
        {step === 'results' && !scan && (
          <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-8 text-center">
            <p className="text-sm text-[#5c5c6e]">Run a scan first to see results.</p>
          </div>
        )}

        {step === 'improve' && scan && (
          <ImproveStep
            scan={scan}
            plan={plan}
            recommendations={(agentRecs ?? []) as AgentRecommendation[]}
            progress={(agentProg ?? []) as AgentProgressType[]}
            competitors={(agentComps ?? []) as AgentCompetitor[]}
          />
        )}
        {step === 'improve' && !scan && (
          <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-8 text-center">
            <p className="text-sm text-[#5c5c6e]">Run a scan first to see agent analysis.</p>
          </div>
        )}

        {step === 'monitor' && (
          <MonitorStep plan={plan} clientId={clientId} summary={summary} missed={missed} />
        )}
      </main>
    </div>
  )
}
