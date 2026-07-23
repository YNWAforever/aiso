import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { PlanFeatures } from '@/lib/types'
import { ScanStep } from '@/components/dashboard/ScanStep'
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import { ImproveStep } from '@/components/dashboard/ImproveStep'
import { MonitorStep } from '@/components/dashboard/MonitorStep'
import { LocalTrustStep } from '@/components/dashboard/local-trust/LocalTrustStep'
import { findNewestMatchingScan } from '@/lib/localTrust'
import { getLocalTrustProfile, getOrCreateLocalTrustSnapshot } from '@/lib/localTrust/store'
import type {
  Scan, AgentRecommendation, AgentProgress as AgentProgressType,
  AgentCompetitor, PulseWeeklySummary, PulseMetric, Client,
} from '@/lib/types'

async function StepHeader({ step, features }: { step: string; features: PlanFeatures }) {
  const t = await getTranslations('dashboard')
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
    roi: {
      title: t('step_roi_title'),
      body: features.local_trust_roi ? t('step_roi_body') : t('step_roi_locked'),
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
  const reportT = await getTranslations('reports')
  const profile  = await requireAuth(lang)
  const supabase = await createServerSupabaseClient()
  const { features } = resolveCommercialEntitlement(profile.accounts)

  const { data: client } = await supabase
    .from('clients').select('id, brand_name, domain, industry, competitors, status, created_at')
    .eq('id', clientId).eq('account_id', profile.account_id).single()

  if (!client) notFound()
  const typedClient = client as Client

  // Fetch a specific scan if scanId is provided
  const scanIdPromise = scanId
    ? supabase.from('scans').select('*').eq('id', scanId).eq('account_id', profile.account_id).single()
    : Promise.resolve({ data: null })

  const localTrustScansPromise = step === 'roi'
    ? supabase.from('scans').select('*').eq('account_id', profile.account_id)
      .order('created_at', { ascending: false }).limit(25)
    : Promise.resolve({ data: [] })

  const [
    { data: latestScan },
    { data: scanHistory },
    { data: specificScan },
    { data: pulseSummary },
    { data: pulseMetrics },
    { data: localTrustScans },
  ] =
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
      localTrustScansPromise,
    ])

  // Use specific scan if scanId was provided, otherwise use latest
  const scan = (scanId ? (specificScan as Scan | null) : (latestScan as Scan | null))

  const summary = (pulseSummary ?? []) as PulseWeeklySummary[]
  const missed  = (pulseMetrics ?? []) as PulseMetric[]
  const localTrustScanRows = Array.isArray(localTrustScans)
    ? localTrustScans as Scan[]
    : localTrustScans ? [localTrustScans as Scan] : []
  const localTrustScan = findNewestMatchingScan(localTrustScanRows, typedClient.domain)

  // Phase 2: agent data for the selected scan
  const agentDataPromise = scan
    ? Promise.all([
        supabase.from('agent_recommendations').select('*').eq('scan_id', scan.id).order('priority').order('impact_score', { ascending: false }),
        supabase.from('agent_progress').select('*').eq('scan_id', scan.id),
        supabase.from('agent_competitors').select('*').eq('scan_id', scan.id).order('mention_rate', { ascending: false }),
      ])
    : Promise.resolve([{ data: null }, { data: null }, { data: null }])
  const localTrustCompetitorsPromise = step === 'roi' && localTrustScan && localTrustScan.id !== scan?.id
    ? supabase.from('agent_competitors').select('*').eq('scan_id', localTrustScan.id).order('mention_rate', { ascending: false })
    : Promise.resolve({ data: null })

  const [
    [{ data: agentRecs }, { data: agentProg }, { data: agentComps }],
    { data: localTrustComps },
  ] = await Promise.all([agentDataPromise, localTrustCompetitorsPromise])

  const agentCompetitors = (agentComps ?? []) as AgentCompetitor[]
  const localTrustCompetitors = localTrustScan
    ? (localTrustScan.id === scan?.id ? agentCompetitors : ((localTrustComps ?? []) as AgentCompetitor[]))
    : []
  const hasAggregatePulseBaseline = summary.some(row => !row.platform)
  const hasLocalTrustBaseline = Boolean(localTrustScan || hasAggregatePulseBaseline)
  const localTrustProfile = step === 'roi'
    ? await getLocalTrustProfile(clientId, profile.account_id)
    : null
  const localTrustData = step === 'roi' && features.local_trust_roi && hasLocalTrustBaseline
    ? await getOrCreateLocalTrustSnapshot({
        client: typedClient,
        accountId: profile.account_id,
        latestScan: localTrustScan,
        profile: localTrustProfile,
        pulseSummary: summary,
        missed,
        competitors: localTrustCompetitors,
      })
    : null

  return (
    <>
      <StepHeader step={step} features={features} />

      <div className="px-6 pt-5">
        <Link
          href={`/${lang}/dashboard/${clientId}/reports`}
          className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-dash-border bg-dash-surface px-4 py-3 text-sm transition-colors hover:bg-dash-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>
            <span className="block font-semibold text-dash-text">{reportT('list_title')}</span>
            <span className="block text-xs text-dash-muted">{reportT('dashboard_entry_body')}</span>
          </span>
          <span className="shrink-0 font-semibold text-primary">
            {features.client_reports_online ? reportT('open_reports') : reportT('upgrade_badge')}
          </span>
        </Link>
      </div>

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
            features={features}
            recommendations={(agentRecs ?? []) as AgentRecommendation[]}
            progress={(agentProg ?? []) as AgentProgressType[]}
            competitors={agentCompetitors}
          />
        )}
        {step === 'improve' && !scan && (
          <div className="rounded-xl border border-dash-border bg-dash-surface p-8 text-center">
            <p className="text-sm text-dash-text mb-1">{t('no_scan_yet')}</p>
            <p className="text-xs text-dash-muted">{t('no_scan_yet_body')}</p>
          </div>
        )}

        {step === 'monitor' && (
          <MonitorStep features={features} clientId={clientId} summary={summary} missed={missed} />
        )}

        {step === 'roi' && (
          <LocalTrustStep
            lang={lang}
            clientId={clientId}
            features={features}
            profile={localTrustProfile}
            snapshot={hasLocalTrustBaseline ? (localTrustData?.snapshot ?? null) : null}
            actions={hasLocalTrustBaseline ? (localTrustData?.actions ?? []) : []}
            competitors={localTrustCompetitors}
          />
        )}
      </main>
    </>
  )
}
