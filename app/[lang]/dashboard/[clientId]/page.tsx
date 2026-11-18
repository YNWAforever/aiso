import Link from 'next/link'
import { WorkspaceHome } from '@/components/dashboard/WorkspaceHome'
import { loadOwnedPulse } from '@/lib/workspace/load-owned-pulse'
import { buildPulseView } from '@/lib/view-models/pulse'
import { loadOwnedWorkspace } from '@/lib/workspace/load-owned-workspace'
import { buildWorkspaceHome } from '@/lib/view-models/workspace-home'
import { buildTodayView } from '@/lib/view-models/today'
import { loadSavedTaskThread, type SavedTaskRead } from '@/lib/conversation-studio/saved-task'
import type { MonthlyReportHomeEntry } from '@/lib/view-models/workspace-home'
import { currentMonthReport } from '@/lib/monthly-report/report-entry'
import { listMonthlyReports } from '@/lib/monthly-report/store'
import { projectScanStatus } from '@/lib/view-models/scan-status'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { isConversationStudioEnabled, isSmeCopilotUiEnabled } from '@/lib/flags'
import { STUDIO_DEFAULT_HOME } from '@/lib/dashboard-nav'
import { BrandToday } from '@/components/dashboard/today/BrandToday'
import { db } from '@/lib/db'
import { redactSecrets } from '@/lib/security/redact-secrets'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { PlanFeatures } from '@/lib/types'
import { ScanStep } from '@/components/dashboard/ScanStep'
import { ScanPicker } from '@/components/dashboard/ScanPicker'
import { loadOwnedScanChoices } from '@/lib/workspace/scan-choices'
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import { ImproveStep } from '@/components/dashboard/ImproveStep'
import { MonitorStep } from '@/components/dashboard/MonitorStep'
import { WhatAiSaysPage } from '@/components/dashboard/sme/WhatAiSaysPage'
import type { ScanQuota } from '@/components/dashboard/ScanStep'
import { readAuthenticatedScanQuota } from '@/lib/security/authenticated-scan-quota'
import { LocalTrustStep } from '@/components/dashboard/local-trust/LocalTrustStep'
import { getLocalTrustProfile, getOrCreateLocalTrustSnapshot } from '@/lib/localTrust/store'
import type {
  Scan, AgentRecommendation, AgentProgress as AgentProgressType,
  AgentCompetitor, PulseWeeklySummary, PulseMetric, Client, LocalTrustProfile,
} from '@/lib/types'

// Neon returns numeric(5,2) as a string ("18.00"), and formatScanScore rejects
// anything but a finite number — a raw row crashed the results step with a 500.
// Convert at the boundary, as loadOwnedWorkspace does. null (a scan that never
// produced a score) passes through untouched.
function withNumericScore<T extends { score: unknown } | null>(row: T): T {
  if (row === null || typeof row.score !== 'string') return row
  return { ...row, score: Number(row.score) }
}
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
  // Read the raw step before defaulting: FEATURE ON must tell an absent/home
  // landing apart from the explicit `?step=overview` WorkspaceHome alias.
  const { step: rawStep, scanId } = await searchParams
  const step = rawStep === 'overview' ? 'home' : rawStep ?? 'home'
  const t = await getTranslations('dashboard')
  const reportT = await getTranslations('reports')
  const portfolioT = await getTranslations('portfolio')
  const profile  = await requireAuth(lang)
  // The approved SME copilot IA makes Today the brand home; the Studio
  // default-home redirect is retired only while that flag is on.
  const smeCopilot = isSmeCopilotUiEnabled()
  if (!smeCopilot && STUDIO_DEFAULT_HOME && isConversationStudioEnabled(clientId) && (rawStep === undefined || rawStep === '' || rawStep === 'home')) {
    redirect(`/${lang}/dashboard/${encodeURIComponent(clientId)}/studio`)
  }
  const entitlement = resolveCommercialEntitlement(profile.accounts)
  const { features } = entitlement

  if (step === 'home') {
    let owned
    try {
      owned = await loadOwnedWorkspace({ clientId, profile, scanId, withTaskCount: true, ...(smeCopilot ? { withSavedWork: true } : {}) })
    } catch {
      return <div className="flex-1 px-6 py-16 text-center">
        <h1 className="mb-2 text-lg font-bold text-dash-text">{t('workspace_load_error_title')}</h1>
        <p className="text-sm text-dash-muted">{t('workspace_load_error_body')}</p>
      </div>
    }
    if (!owned) notFound()
    // This month's deliverable, when one exists. Best-effort: a report read must
    // never turn the workspace home into an error page.
    let monthlyReport: MonthlyReportHomeEntry | null = null
    if (features.client_reports_online) {
      try {
        const current = currentMonthReport(await listMonthlyReports(profile.account_id, clientId))
        monthlyReport = current ? { month: current.month, status: current.status, versionNumber: current.versionNumber } : null
      } catch { monthlyReport = null }
    }
    const workspace = buildWorkspaceHome(owned, monthlyReport)
    if (smeCopilot) {
      const chatEnabled = isConversationStudioEnabled(clientId)
      let savedDiscussion: SavedTaskRead | null = null
      if (chatEnabled) {
        const today = buildTodayView(workspace, { lang, client_reports_online: features.client_reports_online })
        if (today.chatTask) savedDiscussion = await loadSavedTaskThread({ accountId: profile.account_id, profileId: profile.id, clientId, task: today.chatTask })
      }
      return <BrandToday
        workspace={workspace}
        lang={lang}
        chatEnabled={chatEnabled}
        clientReportsOnline={features.client_reports_online}
        savedDiscussion={savedDiscussion}
      />
    }
    return <WorkspaceHome workspace={workspace} lang={lang} />
  }

  if (step === 'monitor') {
    let owned
    try { owned = await loadOwnedPulse({ clientId, profile, withSignals: true }) } catch {
      return <main className="px-6 py-12"><h1 className="text-xl font-bold">{t('workspace_load_error_title')}</h1><p className="mt-3">{t('workspace_load_error_body')}</p></main>
    }
    if (!owned) notFound()
    return <WhatAiSaysPage
      title={t(smeCopilot ? 'step_monitor_sme_title' : 'step_monitor_title')}
      description={smeCopilot ? t('step_monitor_sme_body') : t('step_monitor_body')}
    >
      <MonitorStep features={features} lang={lang} clientId={clientId} view={buildPulseView(owned)} now={new Date()}
        brandIdentity={owned.brandIdentity ?? { name: owned.client.brand_name, aliases: [] }} />
    </WhatAiSaysPage>
  }

  const sql = db()

  // Same order as the scan API's gate (app/api/scan/route.ts): Free cannot
  // scan a brand, a metered plan shows what is left, anything else is unlimited.
  let scanQuota: ScanQuota = { kind: 'unlimited' }
  if (step === 'scan') {
    if (entitlement.plan === 'free') scanQuota = { kind: 'upgrade' }
    else if (entitlement.monthlyScanLimit !== null) {
      try { scanQuota = { kind: 'metered', ...(await readAuthenticatedScanQuota(profile.account_id)) } }
      catch { scanQuota = { kind: 'metered', limit: entitlement.monthlyScanLimit, remaining: null } }
    }
  }
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
          loadOwnedScanChoices({ accountId: profile.account_id, clientId }),
          specificScanPromise,
          sql`select * from pulse_weekly_summary
              where client_id = ${clientId} order by scan_week limit 40`,
          sql`select platform, question, competitors_mentioned, scan_week
              from pulse_metrics
              where client_id = ${clientId} and brand_mentioned = false
              order by scan_week desc limit 50`,
          localTrustScansPromise,
        ])

      const latestScan = withNumericScore((latestRows[0] ?? null) as Scan | null)
      const specificScan = withNumericScore((specificRows[0] ?? null) as Scan | null)

      // Use specific scan if scanId was provided, otherwise use latest
      const scan = (scanId ? specificScan : latestScan)

      const scanHistory = (scanHistoryRows as unknown as Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[])
        .map(withNumericScore)
      const summary = pulseSummaryRows as unknown as PulseWeeklySummary[]
      const missed  = pulseMetricsRows as unknown as PulseMetric[]

      // The list is already scoped to this brand's client_id (and tenant-checked
      // by the scans_client_tenant_fkey composite FK), so the newest row — the
      // list is ordered created_at desc — is the answer. No domain-matching
      // heuristic needed now that client_id ties each scan to its brand.
      const localTrustScanRows = (localTrustRows as unknown as Scan[]).map(withNumericScore)
      const localTrustScan = localTrustScanRows[0] ?? null

      // Enforce existing permissions before data reaches client component props.
      // ROI has its own competitor permission; it never unlocks ImproveStep.
      const allowRoiCompetitors = step === 'roi' && features.local_trust_roi
      // Phase 2: agent data for the selected scan
      const [agentRecRows, agentProgRows, agentCompRows] = scan
        ? await Promise.all([
            features.agent_recs
              ? sql`select * from agent_recommendations where scan_id = ${scan.id} order by priority, impact_score desc`
              : Promise.resolve([]),
            features.agent_progress
              ? sql`select * from agent_progress where scan_id = ${scan.id}`
              : Promise.resolve([]),
            features.agent_competitors || allowRoiCompetitors
              ? sql`select * from agent_competitors where scan_id = ${scan.id} order by mention_rate desc`
              : Promise.resolve([]),
          ])
        : [[], [], []]

      const agentRecs = (agentRecRows as unknown as AgentRecommendation[]).filter(row => features.platform_access.includes(row.platform))
      const agentProg = agentProgRows as unknown as AgentProgressType[]
      const agentCompetitors = agentCompRows as unknown as AgentCompetitor[]

      const localTrustComps = (allowRoiCompetitors && localTrustScan && localTrustScan.id !== scan?.id)
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
    console.error('[dashboard] workspace query failed:', redactSecrets(message))
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
    scan, scanHistory, summary, missed: _missed,
    agentRecs, agentProg, agentCompetitors,
    localTrustScan, localTrustCompetitors,
    localTrustProfile, localTrustData,
  } = workspace

  const hasAggregatePulseBaseline = summary.some(row => !row.platform)
  const hasLocalTrustBaseline = Boolean(localTrustScan || hasAggregatePulseBaseline)
  const scanDisplay = step === 'results' && scan ? projectScanStatus({ score: scan.score, grade: scan.grade ?? null, evidence: scan.results?.evidence }) : null

  // Improve is its own review workspace, not a narrow legacy wizard step. It
  // owns one main landmark and one h1; the scan picker and report entry stay in
  // the same column instead of sitting above the landmark.
  if (step === 'improve') {
    const improveBody = features.agent_recs ? t('step_improve_body') : t('step_improve_locked')
    const reportHref = `/${lang}/dashboard/${clientId}/reports${scan ? `?scanId=${encodeURIComponent(scan.id)}` : ''}`
    return (
      <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6">
        <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-5 sm:pb-6">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-accessible">{t('nav_fixes')}</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-foreground sm:text-3xl">{t('step_improve_title')}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{improveBody}</p>
          </div>
          <Link
            href={reportHref}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {features.client_reports_online ? reportT('open_reports') : reportT('upgrade_badge')}
            <span aria-hidden="true">→</span>
          </Link>
        </header>

        <div className="mt-6">
          {scan ? (
            <ImproveStep
              smeCopilot={smeCopilot}
              scan={scan}
              features={features}
              recommendations={agentRecs}
              progress={agentProg}
              competitors={agentCompetitors}
              scanChoices={scanHistory}
            />
          ) : (
            <div className="space-y-4">
              {scanHistory.length > 0 ? (
                <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
                  <ScanPicker lang={lang} action={`/${lang}/dashboard/${clientId}`} step="improve" scans={scanHistory} className="mb-0" />
                </div>
              ) : null}
              <section className="rounded-2xl border border-border bg-card p-6 text-center sm:p-8">
                <h2 className="text-base font-semibold text-foreground">{t(scanHistory.length > 0 ? 'no_scan_selected' : 'no_scan_yet')}</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{t(scanHistory.length > 0 ? 'no_scan_selected_body' : 'no_scan_yet_body')}</p>
                <Link
                  href={`/${lang}/dashboard/${clientId}?step=scan`}
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('run_new_scan')}
                </Link>
              </section>
            </div>
          )}
        </div>
      </main>
    )
  }

  return (
    <>
      <StepHeader step={step} features={features} />

      <div className="px-6 pt-5">
        <Link
          href={`/${lang}/dashboard/${clientId}/reports${scan ? `?scanId=${encodeURIComponent(scan.id)}` : ''}`}
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
        {step === 'scan' && <ScanStep key={scan?.id ?? clientId} lang={lang} clientId={clientId} client={workspace.typedClient} scan={scan} scanHistory={scanHistory} quota={scanQuota} />}

        {(step === 'results' || step === 'improve') && <ScanPicker lang={lang} action={`/${lang}/dashboard/${clientId}`} step={step} scans={scanHistory} selectedScanId={scan?.id} />}

        {step === 'results' && scan && (scanDisplay?.score != null
          ? <ResultsStep scan={scan} lang={lang} clientId={clientId} />
          : <div className="space-y-4 rounded-xl border border-dash-border bg-dash-surface p-8">
              <p className="break-all text-sm text-dash-muted">{scan.domain}</p>
              <h1 className="text-lg font-semibold text-dash-text">{portfolioT(scanDisplay?.state === 'failed' ? 'scanIncomplete' : 'scanUnknown')}</h1>
              <p className="text-sm text-dash-muted">{t(scanDisplay?.state === 'failed' ? 'scan_collection_failed_body' : 'scan_collection_unknown_body')}</p>
              <Link href={`/${lang}/dashboard/${clientId}?step=scan&scanId=${encodeURIComponent(scan.id)}`}
                className="inline-flex min-h-11 items-center rounded-lg border border-dash-border px-4 text-sm font-medium text-dash-text hover:bg-dash-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t('run_new_scan')}
              </Link>
            </div>)}
        {step === 'results' && !scan && (
          <div className="rounded-xl border border-dash-border bg-dash-surface p-8 text-center">
            <h2 className="text-base font-semibold text-dash-text mb-1">{t('no_scan_selected')}</h2>
            <p className="mx-auto max-w-md text-sm text-dash-muted">{t('no_scan_selected_body')}</p>
            {/* Never a dead end: the empty state always offers the next step. */}
            <Link href={`/${lang}/dashboard/${clientId}?step=scan`}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t('run_new_scan')}
            </Link>
          </div>
        )}

        {step === 'improve' && scan && (
          <ImproveStep
            smeCopilot={smeCopilot}
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


        {step === 'roi' && (
          <LocalTrustStep
            lang={lang}
            clientId={clientId}
            features={features}
            profile={localTrustProfile}
            snapshot={hasLocalTrustBaseline ? (localTrustData?.snapshot ?? null) : null}
            actions={hasLocalTrustBaseline ? (localTrustData?.actions ?? []) : []}
            roiUnavailable={localTrustData?.roi.unavailable ?? null}
            competitors={localTrustCompetitors}
          />
        )}
      </main>
    </>
  )
}
