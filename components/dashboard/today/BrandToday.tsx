import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ArrowRight, ChevronDown, FileText, Radio, ScanSearch, Sparkles } from 'lucide-react'
import { Illustration } from '@/components/ui/illustration'
import { MonthlyReportEntry } from '@/components/reports/MonthlyReportEntry'
import { OverviewStats } from '@/components/dashboard/overview/OverviewStats'
import { ScoreTrend } from '@/components/dashboard/overview/ScoreTrend'
import { PillarScoreCards } from '@/components/PillarScoreCards'
import { RunProgress } from '@/components/pulse/RunProgress'
import { TodayAsk } from '@/components/dashboard/today/TodayAsk'
import { getCheckExplanations } from '@/lib/checkExplanations'
import { buildTodayView } from '@/lib/view-models/today'
import type { WorkspaceHome } from '@/lib/view-models/workspace-home'

/**
 * The brand Today home: one recommended action, one way to ask, at most three
 * numbers; everything else (trend, priorities, health, history, monitoring and
 * tools) is behind one disclosure. Reads the existing WorkspaceHome projection
 * and never fetches or writes.
 */
export async function BrandToday({ workspace, lang, chatEnabled, clientReportsOnline, accountHome = false }: {
  workspace: WorkspaceHome
  lang: string
  chatEnabled: boolean
  clientReportsOnline: boolean
  accountHome?: boolean
}) {
  const t = await getTranslations('today')
  const w = await getTranslations('workspaceHome')
  const reasons = await getTranslations('runProgress.availabilityReasons')
  const view = buildTodayView(workspace, { lang, client_reports_online: clientReportsOnline })
  const base = `/${lang}/dashboard/${encodeURIComponent(workspace.client.id)}`
  const explanations = getCheckExplanations(lang)

  const action = view.action
  const actionSentence = action.kind === 'fix'
    ? t('fixSentence', { check: explanations[action.checkKey]?.question ?? action.checkKey })
    : action.kind === 'next'
      ? w(`nextStep.${action.labelKey}`)
      : t('actionNone')
  const actionDetail = action.kind === 'fix' ? t('fixDetail', { n: String(action.points) }) : undefined
  const actionReason = action.kind === 'next' && action.reasonKey && action.reasonKey !== 'unknown'
    ? reasons(action.reasonKey)
    : action.kind === 'next' && action.reasonKey === 'unknown' ? w('daily.unknown') : null

  const monthLabel = view.monthlyReport
    ? new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${view.monthlyReport.month}-01T00:00:00Z`))
    : null
  const statusLabel = view.monthlyReport
    ? t(`metrics.${view.monthlyReport.status}`)
    : null

  const metricStateCopy: Record<string, string | null> = {
    empty: t('metrics.empty'),
    locked: t('metrics.locked'),
    unknown: t('metrics.unavailable'),
    error: t('metrics.unavailable'),
    ready: null,
  }

  return <main className="mx-auto w-full min-w-0 max-w-5xl break-words space-y-6 px-4 py-8 sm:px-6">
    <header>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-accessible">{accountHome ? t('oneBrandEyebrow') : t('eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-foreground">{view.brandName}</h1>
      {view.domain && <p className="mt-1 text-sm font-medium text-muted-foreground">{view.domain}</p>}
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{t('summary')}</p>
    </header>

    <section aria-labelledby="today-action-heading" className="rounded-2xl border border-primary/30 bg-primary/5 p-5 shadow-e2 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Illustration name={view.illustration} className="h-14 w-20 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id="today-action-heading" className="text-xs font-bold uppercase tracking-wider text-primary-accessible">{t('actionCaption')}</h2>
          <p className="mt-1 text-base font-semibold text-foreground">{actionSentence}</p>
          {actionDetail && <p className="mt-0.5 text-sm text-muted-foreground">{actionDetail}</p>}
          {actionReason && <p className="mt-0.5 text-sm text-muted-foreground">{actionReason}</p>}
        </div>
        {action.kind !== 'none' && <Link
          href={action.href}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-accessible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {action.kind === 'fix' ? w('nextAction.fixCta') : w(`nextStep.${action.labelKey}`)}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>}
      </div>
    </section>

    {chatEnabled && <TodayAsk
      lang={lang}
      clientId={workspace.client.id}
      label={t('askLabel')}
      placeholder={t('askPlaceholder')}
      cta={t('askCta')}
      hint={t('askHint')}
    />}

    <section aria-label={t('eyebrow')} className="grid gap-3 sm:grid-cols-3">
      {view.metrics.map(metric => {
        const label = t(`metrics.${metric.key}`)
        const stateCopy = metricStateCopy[metric.state] ?? null
        return <Link
          key={metric.key}
          href={metric.href}
          className="group min-w-0 rounded-2xl border border-border bg-card p-4 shadow-e1 transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span className="block text-xs font-medium text-muted-foreground">{label}</span>
          <span className="mt-1 block truncate text-2xl font-black tabular-nums text-foreground">
            {metric.value ?? stateCopy ?? t('metrics.empty')}
          </span>
          {metric.key === 'report' && metric.value && statusLabel && <span className="mt-0.5 block text-xs text-muted-foreground">{statusLabel}</span>}
        </Link>
      })}
    </section>

    {chatEnabled && <nav aria-label={t('askLabel')} className="flex flex-wrap gap-2">
      {([
        { key: 'visibility', href: view.links.monitor, Icon: Radio },
        { key: 'improve', href: view.links.improve, Icon: Sparkles },
        { key: 'report', href: view.links.reports, Icon: FileText },
      ] as const).map(({ key, href, Icon }) => <Link
        key={key}
        href={href}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-semibold text-foreground shadow-e1 transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Icon aria-hidden="true" className="size-4 text-primary-accessible" />
        {t(`skills.${key}`)}
      </Link>)}
    </nav>}

    {view.monthlyReport && monthLabel && statusLabel && <MonthlyReportEntry
      lang={lang}
      clientId={workspace.client.id}
      monthKey={view.monthlyReport.month}
      monthLabel={monthLabel}
      title={t('monthlyTitle')}
      versionLabel={t('monthlyVersion', { n: String(view.monthlyReport.versionNumber) })}
      statusLabel={statusLabel}
      openLabel={t('metrics.open')}
    />}

    {view.setup && <details className="rounded-2xl border border-border bg-card p-5 shadow-e1 sm:p-6">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        {t('setup', { n: String(view.setup.remaining) })}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </summary>
      <ul className="mt-3 space-y-1">
        {([
          { key: 'brand', href: base },
          { key: 'scan', href: `${base}?step=scan` },
          { key: 'fixes', href: `${base}?step=improve` },
          { key: 'questions', href: `${base}?step=monitor` },
        ] as const).map(step => <li key={step.key}>
          <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline decoration-primary/30 underline-offset-4" href={step.href}>
            {w(`gettingStarted.steps.${step.key}.title`)}
          </Link>
        </li>)}
      </ul>
    </details>}

    <details className="rounded-2xl border border-border bg-card p-5 shadow-e1 sm:p-6">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        {t('details')}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </summary>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('detailsIntro')}</p>

      <div className="mt-6 space-y-6">
        {workspace.stats && <OverviewStats stats={workspace.stats} lang={lang} resultsHref={view.links.results} />}
        {workspace.stats && <ScoreTrend trend={workspace.stats.trend} lang={lang} />}

        <section aria-labelledby="today-priorities-heading">
          <h3 id="today-priorities-heading" className="text-sm font-bold text-foreground">{w('priorities.title')}</h3>
          {workspace.priorities.state === 'ready'
            ? <ol className="mt-3 space-y-3">
                {workspace.priorities.priorities.map(priority => <li key={priority.checkKey} className="flex gap-3 border-b border-border pb-3 last:border-0">
                  <span aria-hidden="true" className="mt-0.5 size-2 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{explanations[priority.checkKey]?.question ?? priority.checkKey}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{explanations[priority.checkKey]?.fix[priority.assessment]}</p>
                  </div>
                  <span className="shrink-0 self-start rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">{priority.pointsAtStake}</span>
                </li>)}
              </ol>
            : <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{w(`priorities.states.${workspace.priorities.state}`)}</p>}
        </section>

        {workspace.siteHealth.data && <section aria-labelledby="today-health-heading">
          <h3 id="today-health-heading" className="text-sm font-bold text-foreground">{w('siteHealth')}</h3>
          <p className="mt-2 text-3xl font-black tabular-nums text-foreground">
            {workspace.siteHealth.data.score === null ? t('metrics.unavailable') : <>{workspace.siteHealth.data.score}<span className="text-base font-bold text-muted-foreground"> / 100</span></>}
          </p>
          {workspace.siteHealth.data.score !== null && workspace.siteHealth.data.pillarScores && <div className="mt-3">
            <PillarScoreCards results={{ pillarScores: workspace.siteHealth.data.pillarScores }} locale={lang} tone="dashboard" />
          </div>}
        </section>}

        <RunProgress clientId={workspace.client.id} lang={lang} />

        <nav aria-label={w('tools')}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {([
              { key: 'scan', href: view.links.scan, label: w('scan'), Icon: ScanSearch },
              { key: 'results', href: view.links.results ?? `${base}?step=results`, label: w('results'), Icon: ScanSearch },
              { key: 'improve', href: view.links.improve, label: w('improve'), Icon: Sparkles },
              { key: 'reports', href: view.links.reports, label: w('reports'), Icon: FileText },
              { key: 'monitor', href: view.links.monitor, label: w('monitor'), Icon: Radio },
              { key: 'roi', href: view.links.roi, label: w('roi'), Icon: Sparkles },
            ] as const).map(({ key, href, label, Icon }) => <li key={key}>
              <Link href={href} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-semibold text-foreground hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {label}
              </Link>
            </li>)}
          </ul>
        </nav>
      </div>
    </details>
  </main>
}
