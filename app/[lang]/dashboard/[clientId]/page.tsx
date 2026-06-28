import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getPlanFeatures } from '@/lib/tier'
import { ScanStep } from '@/components/dashboard/ScanStep'
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import { ImproveStep } from '@/components/dashboard/ImproveStep'
import { MonitorStep } from '@/components/dashboard/MonitorStep'
import { LocalTrustStep } from '@/components/dashboard/local-trust/LocalTrustStep'
import { getLocalTrustProfile, getOrCreateLocalTrustSnapshot } from '@/lib/localTrust/store'
import type {
  Scan, AgentRecommendation, AgentProgress as AgentProgressType,
  AgentCompetitor, PulseWeeklySummary, PulseMetric, Client,
} from '@/lib/types'

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
  const profile  = await requireAuth(lang)
  const supabase = await createServerSupabaseClient()
  const plan = profile.accounts?.plan ?? 'basic'
  const features = getPlanFeatures(plan)

  const { data: client } = await supabase
    .from('clients').select('id, brand_name, domain, industry, competitors, status, created_at')
    .eq('id', clientId).eq('account_id', profile.account_id).single()

  if (!client) notFound()
  const typedClient = client as Client

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
  const agentCompetitors = (agentComps ?? []) as AgentCompetitor[]
  const localTrustScan = domainsMatch(scan?.domain, typedClient.domain) ? scan : null
  const localTrustCompetitors = localTrustScan ? agentCompetitors : []
  const hasLocalTrustBaseline = Boolean(localTrustScan || summary.length > 0 || missed.length > 0)
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
          <MonitorStep plan={plan} clientId={clientId} summary={summary} missed={missed} />
        )}

        {step === 'roi' && (
          <LocalTrustStep
            lang={lang}
            clientId={clientId}
            plan={plan}
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
