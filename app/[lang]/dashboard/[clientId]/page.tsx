import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
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

async function StepHeader({ step, plan }: { step: string; plan: string }) {
  const t = await getTranslations('dashboard')
  const features = getPlanFeatures(plan)
  const info: Record<string, { title: string; body: string }> = {
    scan: {
      title: t('step_scan_title'),
      body: t('step_scan_body'),
    },
    results: {
      title: t('step_results_title'),
      body: t('step_results_body'),
    },
    improve: {
      title: t('step_improve_title'),
      body: features.agent_recs ? t('step_improve_body') : t('step_improve_locked'),
    },
    monitor: {
      title: t('step_monitor_title'),
      body: t('step_monitor_body'),
    },
  }
  const i = info[step] ?? info.scan!

  return (
    <div className="mb-6 pt-6 px-6">
      <p className="text-lg font-bold text-dash-text mb-1.5">{i.title}</p>
      <p className="text-[12px] text-dash-muted leading-relaxed max-w-2xl">{i.body}</p>
    </div>
  )
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams: Promise<{ step?: string; scanId?: string }>
}) {
  const { lang, clientId } = await params
  const { step = 'scan', scanId } = await searchParams
  const t = await getTranslations('dashboard')
  const profile  = await requireAuth(lang)
  const supabase = await createServerSupabaseClient()
  const plan = profile.accounts?.plan ?? 'basic'

  const { data: client } = await supabase
    .from('clients').select('brand_name')
    .eq('id', clientId).eq('account_id', profile.account_id).single()

  if (!client) notFound()

  // Fetch a specific scan if scanId is provided
  const scanIdPromise = scanId
    ? supabase.from('scans').select('*').eq('id', scanId).eq('account_id', profile.account_id).single()
    : Promise.resolve({ data: null })

  const [{ data: latestScan }, { data: scanHistory }, { data: specificScan }, { data: pulseSummary }, { data: pulseMetrics }] =
    await Promise.all([
      supabase.from('scans').select('*').eq('account_id', profile.account_id)
        .order('created_at', { ascending: false }).limit(1).single(),
      supabase.from('scans').select('id,domain,score,grade,created_at')
        .eq('account_id', profile.account_id).order('created_at', { ascending: false }).limit(10),
      scanIdPromise,
      supabase.from('pulse_weekly_summary').select('*')
        .eq('client_id', clientId).order('scan_week').limit(40),
      supabase.from('pulse_metrics')
        .select('platform,question,competitors_mentioned,scan_week')
        .eq('client_id', clientId).eq('brand_mentioned', false)
        .order('scan_week', { ascending: false }).limit(50),
    ])

  // Use specific scan if scanId was provided, otherwise use latest
  const scan = (scanId ? (specificScan as Scan | null) : (latestScan as Scan | null))

  // Phase 2: agent data for the selected scan
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
        {step === 'scan' && <ScanStep lang={lang} clientId={clientId} scan={scan} scanHistory={(scanHistory ?? []) as Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]} />}

        {step === 'results' && scan && <ResultsStep scan={scan} lang={lang} clientId={clientId} />}
        {step === 'results' && !scan && (
          <div className="rounded-xl border border-dash-border bg-dash-surface p-8 text-center">
            <p className="text-sm text-dash-text mb-1">{t('no_scan_selected')}</p>
            <p className="text-xs text-dash-muted">{t('no_scan_selected_body')}</p>
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
          <div className="rounded-xl border border-dash-border bg-dash-surface p-8 text-center">
            <p className="text-sm text-dash-text mb-1">{t('no_scan_yet')}</p>
            <p className="text-xs text-dash-muted">{t('no_scan_yet_body')}</p>
          </div>
        )}

        {step === 'monitor' && (
          <MonitorStep plan={plan} clientId={clientId} summary={summary} missed={missed} />
        )}
      </main>
    </>
  )
}
