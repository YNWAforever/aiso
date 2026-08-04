import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { PlanFeatures } from '@/lib/types'
import { ScanStep } from '@/components/dashboard/ScanStep'
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import { ImproveStep } from '@/components/dashboard/ImproveStep'
import { MonitorStep } from '@/components/dashboard/MonitorStep'
import { LocalTrustStep } from '@/components/dashboard/local-trust/LocalTrustStep'
import { getLocalTrustProfile, getOrCreateLocalTrustSnapshot } from '@/lib/localTrust/store'
import type {
  Scan, AgentRecommendation, AgentProgress as AgentProgressType,
  AgentCompetitor, PulseWeeklySummary, PulseMetric, Client, LocalTrustProfile,
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

type Workspace = {
  typedClient: Client
  scan: Scan | null
  scanHistory: Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]
  summary: PulseWeeklySummary[]
  missed: PulseMetric[]
  agentRecs: AgentRecommendation[]
  agentProg: AgentProgressType[]
  agentCompetitors: AgentCompetitor[]
  localTrustScan: Scan | null
  localTrustCompetitors: AgentCompetitor[]
  localTrustProfile: LocalTrustProfile | null
  localTrustData: Awaited<ReturnType<typeof getOrCreateLocalTrustSnapshot>> | null
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
  const { features } = resolveCommercialEntitlement(profile.accounts)

  const sql = db()

  let workspace: Workspace | null = null
  let clientMissing = false
  let loadError = false

  try {
    const clientRows = await sql`
      select id, brand_name, domain, industry, competitors, status, created_at
      from clients
      where id = ${clientId} and account_id = ${profile.account_id}
      limit 1
    `
    const client = clientRows[0] as Client | undefined

    if (!client) {
      clientMissing = true
    } else {
      const typedClient = client as Client

      // Fetch a specific scan if scanId is provided — matched on id, account_id,
      // AND client_id, so a scan id from another brand cannot render here.
      const specificScanPromise = scanId
        ? sql`select * from scans where id = ${scanId} and account_id = ${profile.account_id} and client_id = ${clientId} limit 1`
        : Promise.resolve([])

      const localTrustScansPromise = step === 'roi'
        ? sql`select * from scans where client_id = ${clientId} and account_id = ${profile.account_id}
              order by created_at desc limit 25`
        : Promise.resolve([])

      const [
        latestRows,
        scanHistoryRows,
        specificRows,
        pulseSummaryRows,
        pulseMetricsRows,
        localTrustRows,
      ] =
        await Promise.all([
          sql`select * from scans where client_id = ${clientId} and account_id = ${profile.account_id}
              order by created_at desc limit 1`,
          sql`select id, domain, score, grade, created_at from scans
              where client_id = ${clientId} and account_id = ${profile.account_id}
              order by created_at desc limit 10`,
          specificScanPromise,
          sql`select * from pulse_weekly_summary
              where client_id = ${clientId} order by scan_week limit 40`,
          sql`select platform, question, competitors_mentioned, scan_week
              from pulse_metrics
              where client_id = ${clientId} and brand_mentioned = false
              order by scan_week desc limit 50`,
          localTrustScansPromise,
        ])

      const latestScan = (latestRows[0] ?? null) as Scan | null
      const specificScan = (specificRows[0] ?? null) as Scan | null

      // Use specific scan if scanId was provided, otherwise use latest
      const scan = (scanId ? specificScan : latestScan)

      const scanHistory = scanHistoryRows as unknown as Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]
      const summary = pulseSummaryRows as unknown as PulseWeeklySummary[]
      const missed  = pulseMetricsRows as unknown as PulseMetric[]

      // The list is already scoped to this brand's client_id (and tenant-checked
      // by the scans_client_tenant_fkey composite FK), so the newest row — the
      // list is ordered created_at desc — is the answer. No domain-matching
      // heuristic needed now that client_id ties each scan to its brand.
      const localTrustScanRows = localTrustRows as unknown as Scan[]
      const localTrustScan = localTrustScanRows[0] ?? null

      // Phase 2: agent data for the selected scan
      const [agentRecRows, agentProgRows, agentCompRows] = scan
        ? await Promise.all([
            sql`select * from agent_recommendations where scan_id = ${scan.id} order by priority, impact_score desc`,
            sql`select * from agent_progress where scan_id = ${scan.id}`,
            sql`select * from agent_competitors where scan_id = ${scan.id} order by mention_rate desc`,
          ])
        : [[], [], []]

      const agentRecs = agentRecRows as unknown as AgentRecommendation[]
      const agentProg = agentProgRows as unknown as AgentProgressType[]
      const agentCompetitors = agentCompRows as unknown as AgentCompetitor[]

      const localTrustComps = (step === 'roi' && localTrustScan && localTrustScan.id !== scan?.id)
        ? await sql`select * from agent_competitors where scan_id = ${localTrustScan.id} order by mention_rate desc`
        : []

      const localTrustCompetitors = localTrustScan
        ? (localTrustScan.id === scan?.id ? agentCompetitors : (localTrustComps as unknown as AgentCompetitor[]))
        : []

      // Local Trust reads belong inside this try/catch like every other
      // workspace query — a failure here must render the same
      // workspace_load_error_* state, not throw past the page boundary.
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

      workspace = {
        typedClient, scan, scanHistory, summary, missed,
        agentRecs, agentProg, agentCompetitors,
        localTrustScan, localTrustCompetitors,
        localTrustProfile, localTrustData,
      }
    }
  } catch (err) {
    loadError = true
    const message = err instanceof Error ? err.message : String(err)
    console.error('[dashboard] workspace query failed:', message.replace(/postgresql:\/\/\S+/g, '[redacted]'))
  }

  // A database failure must not look like a brand that does not exist.
  if (clientMissing) notFound()
  if (loadError || !workspace) {
    return (
      <div className="flex-1 px-6 py-16 text-center">
        <p className="text-lg font-bold text-dash-text mb-1.5">{t('workspace_load_error_title')}</p>
        <p className="text-sm text-dash-muted max-w-md mx-auto">{t('workspace_load_error_body')}</p>
      </div>
    )
  }

  const {
    scan, scanHistory, summary, missed,
    agentRecs, agentProg, agentCompetitors,
    localTrustScan, localTrustCompetitors,
    localTrustProfile, localTrustData,
  } = workspace

  const hasAggregatePulseBaseline = summary.some(row => !row.platform)
  const hasLocalTrustBaseline = Boolean(localTrustScan || hasAggregatePulseBaseline)

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
        {step === 'scan' && <ScanStep lang={lang} clientId={clientId} scan={scan} scanHistory={scanHistory} />}

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
            recommendations={agentRecs}
            progress={agentProg}
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
