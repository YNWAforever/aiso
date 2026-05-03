import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getPlanFeatures } from '@/lib/tier'
import { ScanStep } from '@/components/dashboard/ScanStep'
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import { ImproveStep } from '@/components/dashboard/ImproveStep'
import { MonitorStep } from '@/components/dashboard/MonitorStep'
import {
  Scan, AgentRecommendation, AgentProgress as AgentProgressType,
  AgentCompetitor, PulseWeeklySummary, PulseMetric,
} from '@/lib/types'

function StepHeader({ step, plan }: { step: string; plan: string }) {
  const features = getPlanFeatures(plan)
  const info: Record<string, { title: string; body: string }> = {
    scan: {
      title: 'Run a scan',
      body: `Enter any URL to run a 20-check diagnostic. We'll assess how visible your content is to AI search engines like ChatGPT, Claude, and Gemini. Free for everyone — no subscription needed.`,
    },
    results: {
      title: 'Scan results',
      body: `Your full diagnostic report. Each of the 20 checks shows a pass, warn, or fail status with an explanation of why it matters and how to fix it. Open any check to see the details.`,
    },
    improve: {
      title: 'Improve with AI agents',
      body: features.agent_recs
        ? `AI agents analyze your scan and give you specific recommendations. Each platform (Gemini, GPT-4o, Claude, Perplexity) evaluates your content differently — we show you what each one needs.`
        : `Upgrade to Pro to unlock AI agent analysis. Get platform-specific recommendations from Gemini, GPT-4o, Claude, and Perplexity. Track your progress over time with before-and-after metrics.`,
    },
    monitor: {
      title: 'Monitor your ranking',
      body: `Track your Share of Voice — how often your brand appears in AI-generated answers across all platforms. See which queries you're missing and where competitors are showing up instead.`,
    },
  }
  const i = info[step] ?? info.scan!

  return (
    <div className="mb-6 pt-6 px-6">
      <p className="text-lg font-bold text-[#e0e0ec] mb-1.5">{i.title}</p>
      <p className="text-[12px] text-[#5c5c6e] leading-relaxed max-w-2xl">{i.body}</p>
    </div>
  )
}

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

  const [{ data: agentRecs }, { data: agentProg }, { data: agentComps }] = scan
    ? await Promise.all([
        supabase.from('agent_recommendations').select('*').eq('scan_id', scan.id).order('priority').order('impact_score', { ascending: false }),
        supabase.from('agent_progress').select('*').eq('scan_id', scan.id),
        supabase.from('agent_competitors').select('*').eq('scan_id', scan.id).order('mention_rate', { ascending: false }),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  const summary = (pulseSummary ?? []) as PulseWeeklySummary[]
  const missed  = (pulseMetrics ?? []) as PulseMetric[]

  return (
    <>
      <StepHeader step={step} plan={plan} />

      <main className="flex-1 px-6 pb-10 max-w-3xl">
        {step === 'scan' && <ScanStep lang={lang} scan={scan} scanHistory={(scanHistory ?? []) as Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]} />}

        {step === 'results' && scan && <ResultsStep scan={scan} />}
        {step === 'results' && !scan && (
          <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-8 text-center">
            <p className="text-sm text-[#e0e0ec] mb-1">No scan yet</p>
            <p className="text-xs text-[#5c5c6e]">Go to the Scan step first to run a diagnostic.</p>
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
            <p className="text-sm text-[#e0e0ec] mb-1">No scan yet</p>
            <p className="text-xs text-[#5c5c6e]">AI agent analysis requires a completed scan. Run one from the Scan step.</p>
          </div>
        )}

        {step === 'monitor' && (
          <MonitorStep plan={plan} clientId={clientId} summary={summary} missed={missed} />
        )}
      </main>
    </>
  )
}
