import {RunProgress} from '@/components/pulse/RunProgress'
import {PulseCoverage} from '@/components/pulse/PulseCoverage'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight, BarChart3, ChevronDown, Clock, FileText, Gauge, ListChecks, MapPin, MessageSquareText, ScanSearch, Sparkles } from 'lucide-react'
import { MONITOR_VISIBLE } from '@/lib/dashboard-nav'
import { PillarScoreCards } from '@/components/PillarScoreCards'
import { getCheckExplanations } from '@/lib/checkExplanations'
import type { WorkspaceHome as HomeDto } from '@/lib/view-models/workspace-home'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/** Pure presentation of the owned server projection. Does not fetch or write. */
export function WorkspaceHome({ workspace, lang }: { workspace: HomeDto; lang: string }) {
  const copy = (lang === 'zh-HK' ? zhHK : en).workspaceHome
  const base = `/${lang}/dashboard/${workspace.client.id}`
  // Flush-left with the text above them (no horizontal padding), 44px tall for touch.
  const linkClass = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-primary-accessible underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
  const primaryClass = 'inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-accessible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
  const cardClass = 'flex min-w-0 flex-col rounded-2xl border border-dash-border bg-dash-surface p-5 shadow-sm sm:p-6'
  function panel(title: string, section: { state: HomeDto['visibility']['state']; observedAt: string|null }, children: ReactNode, className = '') {
    return <section className={`${cardClass} ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-bold text-dash-text">{title}</h2>
        <p className="inline-flex items-center gap-1.5 text-xs text-dash-muted"><Clock aria-hidden="true" className="size-3.5 shrink-0" />{section.observedAt ? <>{copy.observedAt}: <time dateTime={section.observedAt}>{section.observedAt.replace('T', ' ').replace('.000Z', ' UTC')}</time></> : copy.noDate}</p>
      </div>
      <details className="group mt-1 text-xs text-dash-muted">
        <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded hover:text-dash-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">{copy.evidenceDetails}<ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
        <p className="mt-1 leading-relaxed">{copy.freshnessUnknown}</p>
      </details>
      <div className="mt-5 flex flex-1 flex-col">{['ready','complete','partial'].includes(section.state) ? children : <p className="text-sm leading-relaxed text-dash-muted">{section.state==='ready'?'':copy.states[section.state]}</p>}</div>
      {section.state === 'locked' && <Link className={`${linkClass} mt-4`} href={`/${lang}/pricing`}>{copy.pricing}<ArrowRight aria-hidden="true" className="size-4" /></Link>}
    </section>
  }
  /** A card's closing link, pinned to the bottom so cards in one row align. */
  const cardLink = (href: string, label: ReactNode) => <div className="mt-auto pt-4"><Link className={linkClass} href={href}>{label}<ArrowRight aria-hidden="true" className="size-4" /></Link></div>
  const toolIcons = { scan: ScanSearch, results: ListChecks, improve: Sparkles } as const
  // Monitor stays reachable by URL but is not advertised until Pulse is scheduled.
  const nextStep = workspace.nextStep && (MONITOR_VISIBLE || !workspace.nextStep.href.includes('?step=monitor')) ? workspace.nextStep : null
  const health = workspace.siteHealth.data
  const visibility = workspace.visibility.data
  const priorities = workspace.priorities
  const pcopy = copy.priorities
  const explanations = getCheckExplanations(lang)
  return <main className="mx-auto w-full min-w-0 max-w-6xl break-words px-4 py-8 sm:px-6">
    <header className="mb-8">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-accessible">{copy.title}</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-dash-text">{workspace.client.brand_name}</h1>
      <p className="mt-1 text-sm font-medium text-dash-muted">{workspace.client.domain}</p>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-dash-muted">{copy.summary}</p>
      {nextStep&&<Link className={`${primaryClass} mt-5`} href={nextStep.href.replace("__locale__",lang)}>{copy.nextStep[nextStep.labelKey]}<ArrowRight aria-hidden="true" className="size-4" /></Link>}
      {nextStep?.reasonKey&&<p className="mt-2 max-w-3xl text-sm leading-relaxed text-dash-muted">{nextStep.reasonKey==='unknown'?copy.daily.unknown:(lang==='zh-HK'?zhHK:en).runProgress.availabilityReasons[nextStep.reasonKey]}</p>}
    </header>
    {workspace.dailyWork&&<details aria-labelledby="daily-work-heading" className="group mb-8 space-y-3 rounded-2xl border border-dash-border bg-dash-surface p-5 shadow-sm sm:p-6">
      <summary id="daily-work-heading" className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-lg font-bold text-dash-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">{copy.daily.title}<ChevronDown aria-hidden="true" className="size-5 shrink-0 text-dash-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
      <p className="text-dash-text">{copy.daily.states[workspace.dailyWork.state]}</p>
      {workspace.dailyWork.coverage&&<p className="text-dash-muted">{copy.daily.coverage.replace('{succeeded}',String(workspace.dailyWork.coverage.succeeded)).replace('{expected}',String(workspace.dailyWork.coverage.expected)).replace('{failed}',String(workspace.dailyWork.coverage.failed)).replace('{pending}',String(workspace.dailyWork.coverage.pending)).replace('{blocked}',String(workspace.dailyWork.coverage.blocked)).replace('{classified}',String(workspace.dailyWork.coverage.classified))}</p>}
      <p className="text-dash-muted">{copy.daily.lastComplete}: {workspace.dailyWork.lastCompleteAt??copy.daily.unknown}</p>
      <p className="text-dash-muted">{copy.daily.nextDue}: {copy.daily.unknown}</p>
      {workspace.dailyWork.partialReads&&<p>{copy.daily.partialReads}</p>}
      <ol>{workspace.dailyWork.nextActions.map(action=><li key={`${action.kind}:${action.path}`}><Link className={linkClass} href={`${base}${action.path}`}>{copy.daily.actions[action.kind]}</Link></li>)}</ol>
      <p className="text-sm text-dash-muted">{copy.daily.manual}</p>
    </details>}
    <section aria-labelledby="priorities-heading" className="mb-8 min-w-0 rounded-2xl border border-dash-border bg-dash-surface p-5 shadow-sm sm:p-6">
      <h2 id="priorities-heading" className="text-lg font-bold text-dash-text">{pcopy.title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-dash-muted">{pcopy.summary}</p>
      {priorities.state === 'ready'
        ? <>
            <ol className="mt-5 space-y-4">
              {priorities.priorities.map((priority, index) => {
                const explanation = explanations[priority.checkKey]
                return <li key={priority.checkKey} className="flex gap-4 border-b border-dash-border pb-4 last:border-0">
                  <span aria-hidden="true" className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-black tabular-nums ${index === 0 ? 'bg-primary text-primary-foreground' : 'bg-dash-elevated text-dash-muted'}`}>{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    {index === 0 && <p className="text-xs font-bold uppercase tracking-wider text-primary-accessible">{pcopy.primary}</p>}
                    <p className="mt-0.5 text-sm font-semibold text-dash-text">{explanation?.question ?? priority.checkKey}</p>
                    {explanation && <p className="mt-1.5 text-sm leading-relaxed text-dash-muted">{explanation.fix[priority.assessment]}</p>}
                  </div>
                  <p className="shrink-0 self-start rounded-full bg-dash-elevated px-2.5 py-1 text-xs font-semibold tabular-nums text-dash-text">{priority.pointsAtStake} {pcopy.pointsAtStake}</p>
                </li>
              })}
            </ol>
            <p className="mt-4 text-xs text-dash-muted">{pcopy.showing} {priorities.priorities.length} {pcopy.of} {priorities.observedFindings} {pcopy.findings}</p>
            {health && <Link className={`${linkClass} mt-2`} href={`${base}?step=results&scanId=${encodeURIComponent(health.scanId)}`}>{pcopy.openResults}<ArrowRight aria-hidden="true" className="size-4" /></Link>}
          </>
        : <p className="mt-5 max-w-3xl text-sm leading-relaxed text-dash-muted">{pcopy.states[priorities.state]}</p>}
      {priorities.needsEvidence.length > 0 && <div className="mt-5 border-t border-dash-border pt-4">
        <p className="text-sm font-semibold text-dash-text">{pcopy.needsEvidence} ({priorities.needsEvidence.length})</p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-dash-muted">{pcopy.needsEvidenceNote}</p>
      </div>}
    </section>
    <RunProgress clientId={workspace.client.id} lang={lang}/>
    <div className="grid min-w-0 gap-5 lg:grid-cols-3">
      {panel(copy.siteHealth, workspace.siteHealth, health && <>
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-dash-muted"><Gauge aria-hidden="true" className="size-4" />{copy.score}</p>
        <p className="mt-1 text-4xl font-black tracking-tight text-dash-text">{health.score===null?(health.displayState==='failed'?(lang==='zh-HK'?zhHK:en).portfolio.scanIncomplete:(lang==='zh-HK'?zhHK:en).portfolio.scanUnknown):<><span className="tabular-nums">{health.score}</span><span className="text-xl font-bold text-dash-muted"> / 100</span>{health.grade&&<span className="ml-3 inline-flex rounded-lg bg-primary/10 px-2.5 py-0.5 align-middle text-lg font-black text-primary-accessible">{health.grade}</span>}</>}</p>
        <div className="mt-5">{health.score!==null&&health.pillarScores ? <PillarScoreCards results={{ pillarScores: health.pillarScores }} locale={lang} tone="dashboard" /> : <p className="text-sm text-dash-muted">{copy.noPillars}</p>}</div>
        {cardLink(`${base}?step=results&scanId=${encodeURIComponent(health.scanId)}`, copy.results)}
      </>, 'lg:col-span-3')}
      {panel(copy.visibility, workspace.visibility, <>
        <p className="text-4xl font-black tracking-tight tabular-nums text-dash-text">{visibility?`${Number(visibility.sovScore.toFixed(1))}%`:(lang==='zh-HK'?zhHK:en).pulseView.unknown}</p>
        {workspace.visibility.state==='partial'&&<p className="mt-1 text-sm text-dash-muted">{(lang==='zh-HK'?zhHK:en).pulseView.partial}</p>}<PulseCoverage coverage={workspace.visibility.coverage} lang={lang} href={`${base}/observations?result=incomplete`}/><dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
          {([[copy.mentions, visibility?.brandMentions], [copy.queries, visibility?.totalQueries], [copy.platforms, visibility?.platformCount]] as const).map(([label, value]) => <div key={label} className="min-w-0 rounded-xl bg-dash-elevated px-3 py-2.5"><dt className="text-xs leading-snug text-dash-muted">{label}</dt><dd className="mt-0.5 text-lg font-bold tabular-nums text-dash-text">{value??'—'}</dd></div>)}
        </dl>
        {MONITOR_VISIBLE && cardLink(`${base}?step=monitor`, copy.monitor)}
      </>)}
      {panel(copy.recommendations, workspace.recommendations, <ul className="space-y-4">{workspace.recommendations.data?.map(rec => <li key={rec.id} className="border-b border-dash-border pb-4 last:border-0">
        <p className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary-accessible">{copy.draft}</p><p className="mt-2 text-sm leading-relaxed text-dash-text">{rec.recommendation}</p><p className="mt-2 inline-flex items-center gap-1.5 text-xs text-dash-muted"><MessageSquareText aria-hidden="true" className="size-3.5" />{rec.platform}</p>
      </li>)}</ul>)}
      {panel(copy.history, workspace.history, <ul className="divide-y divide-dash-border">{workspace.history.data?.map(scan => <li key={scan.id} className="py-2 first:pt-0">
        <Link className={linkClass} href={`${base}?step=results&scanId=${encodeURIComponent(scan.id)}`}>{copy.openScan}: {scan.score===null?(scan.displayState==='failed'?(lang==='zh-HK'?zhHK:en).portfolio.scanIncomplete:(lang==='zh-HK'?zhHK:en).portfolio.scanUnknown):`${scan.score} / 100 · ${scan.grade??'—'}`}</Link>
        <p className="text-xs text-dash-muted"><time dateTime={scan.created_at}>{scan.created_at.replace('T', ' ').replace('.000Z', ' UTC')}</time></p>
      </li>)}</ul>)}
    </div>
    <section aria-labelledby="local-visibility-heading" className={`${cardClass} mt-5 sm:flex-row sm:items-center sm:gap-5`}>
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-accessible"><MapPin className="size-5" /></span>
      <div className="mt-3 min-w-0 flex-1 sm:mt-0">
        <h2 id="local-visibility-heading" className="text-lg font-bold text-dash-text">{copy.localVisibility.title}</h2>
        <p className="mt-1 text-sm text-dash-muted">{copy.localVisibility.body}</p>
      </div>
      <Link className={`${linkClass} mt-2 shrink-0 sm:mt-0`} href={`${base}?step=roi`}>{copy.localVisibility.cta}<ArrowRight aria-hidden="true" className="size-4" /></Link>
    </section>
    <section className="mt-10 border-t border-dash-border pt-8"><h2 className="text-lg font-bold text-dash-text">{copy.tools}</h2>
      <nav aria-label={copy.tools} className="mt-4">
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
          {([...(['scan','results','improve'] as const).map(step => ({ key: step, href: `${base}?step=${step}`, label: copy[step], Icon: toolIcons[step] })), { key: 'reports', href: `${base}/reports`, label: copy.reports, Icon: FileText }, { key: 'prompts', href: `${base}/prompts`, label: copy.prompts, Icon: BarChart3 }]).map(({ key, href, label, Icon }) => <li key={key}>
            <Link className="group flex min-h-14 items-center gap-3 rounded-xl border border-dash-border bg-dash-surface px-4 py-3 text-sm font-semibold text-dash-text shadow-sm transition-colors hover:border-primary/40 hover:bg-dash-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href={href}>
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-accessible"><Icon className="size-4" /></span>
              <span className="min-w-0 flex-1">{label}</span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-dash-muted transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </Link>
          </li>)}
        </ul>
      </nav>
    </section>
  </main>
}
