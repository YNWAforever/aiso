import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PulseCoverage } from './PulseCoverage'
import { SovChart } from './SovChart'
import { buildVisibilityOverview } from '@/lib/view-models/visibility-summary'
import { studioTaskHref } from '@/lib/conversation-studio/task-handoff'
import type { PulseView } from '@/lib/view-models/pulse'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/**
 * The full Pulse report. Three questions in reading order: where do we stand,
 * what changed, and what should I do next. All figures come from the stored
 * observed view; this component never re-scores, fills gaps or claims that a
 * later change came from an earlier action.
 */
export function PulseReportView({ view, lang }: { view: PulseView; lang: string }) {
  const messages = lang === 'zh-HK' ? zhHK : en
  const copy = messages.pulseView
  const report = copy.report
  const visibility = copy.visibility
  const overview = buildVisibilityOverview(view)
  const base = `/${lang}/dashboard/${encodeURIComponent(view.client.id)}`
  const hasNumbers = overview.state === 'ready' || overview.state === 'partial'
  const deltaText = overview.delta === null
    ? visibility.noComparison
    : overview.delta > 0
      ? visibility.deltaUp.replace('{delta}', String(overview.delta))
      : overview.delta < 0
        ? visibility.deltaDown.replace('{delta}', String(Math.abs(overview.delta)))
        : visibility.deltaFlat
  const freshness = overview.latestWeek
    ? visibility.freshWeek.replace('{week}', overview.latestWeek)
    : visibility.never
  const nextHref = hasNumbers ? `${base}?step=improve` : `${base}?step=monitor`
  const nextLabel = hasNumbers ? report.nextImprove : overview.state === 'error' ? report.nextRetry : report.nextBaseline
  const askHref = studioTaskHref({ lang, clientId: view.client.id, task: 'pulse', ask: report.askPrompt })

  return <div className="min-w-0 space-y-5 break-words">
    <section aria-labelledby="pulse-baseline-heading" className="rounded-2xl border border-border bg-card p-5 shadow-e2 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-accessible">{report.eyebrow}</p>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="pulse-baseline-heading" className="text-sm font-semibold text-muted-foreground">{visibility.mentionRate}</h2>
          <p className={`mt-1 text-4xl font-black tracking-tight tabular-nums ${hasNumbers ? 'text-foreground' : 'text-xl font-semibold text-muted-foreground'}`}>
            {hasNumbers && overview.sov !== null ? `${Number(overview.sov.toFixed(1))}%` : copy.unknown}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${overview.state === 'partial' ? 'bg-tone-warning-soft text-tone-warning-fg' : 'bg-muted text-muted-foreground'}`}>{freshness}</span>
          {hasNumbers && <span className="text-sm font-semibold tabular-nums text-muted-foreground">{deltaText}</span>}
          {overview.state === 'partial' && <span className="text-xs font-semibold text-tone-warning-fg">{copy.partial}</span>}
        </div>
      </div>
      {overview.state === 'error' ? <p role="alert" className="mt-4 rounded-xl border border-tone-danger/40 bg-tone-danger-soft p-3 text-sm text-tone-danger-fg">{copy.error}</p> : overview.state === 'empty' ? <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/30 p-4"><p className="text-sm font-semibold text-foreground">{visibility.emptyTitle}</p><p className="mt-1 text-sm text-muted-foreground">{visibility.emptyBody}</p></div> : <>
        <PulseCoverage coverage={overview.coverage} lang={lang} href={`${base}/observations?result=incomplete`} />
      </>}
      <p className="mt-3 text-xs text-muted-foreground">{copy.freshness}</p>
    </section>

    <section aria-labelledby="pulse-change-heading" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <h2 id="pulse-change-heading" className="text-lg font-bold text-foreground">{report.whatChanged}</h2>
      {overview.trend.length > 1
        ? <div className="mt-2"><SovChart data={overview.trend} lang={lang} /></div>
        : <p className="mt-2 text-sm text-muted-foreground">{report.changeUnavailable}</p>}
    </section>

    <section aria-labelledby="pulse-next-heading" className="rounded-2xl border border-primary/30 bg-primary/5 p-5 shadow-e2 sm:p-6">
      <h2 id="pulse-next-heading" className="text-lg font-bold text-foreground">{report.next}</h2>
      {hasNumbers && <p className="mt-1 text-sm text-muted-foreground">{report.nextBody}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link href={nextHref} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-accessible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {nextLabel}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
        {hasNumbers && <Link href={askHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline decoration-primary/30 underline-offset-4">{report.askAi}</Link>}
      </div>
    </section>

    <details className="group rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        {report.evidence}
        <span aria-hidden="true" className="text-lg leading-none text-muted-foreground transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="mt-4 space-y-6">
        <p className="text-sm text-muted-foreground">{copy.intro}</p>
        <section aria-labelledby="pulse-questions-heading">
          <h3 id="pulse-questions-heading" className="text-sm font-semibold text-foreground">{copy.prompts}</h3>
          {view.prompts.state !== 'ready'
            ? <p className="mt-2 text-sm text-muted-foreground">{view.prompts.state === 'error' ? copy.error : copy.empty}</p>
            : <ul className="mt-2 divide-y divide-border">{view.prompts.data.map(prompt => <li key={prompt.id} className="flex items-start justify-between gap-3 py-2.5 text-sm text-foreground first:pt-0 last:pb-0"><span className="min-w-0">{prompt.question}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${prompt.is_active ? 'bg-tone-success-soft text-tone-success-fg' : 'bg-muted text-muted-foreground'}`}>{prompt.is_active ? copy.active : copy.inactive}</span></li>)}</ul>}
        </section>

        {view.observations.series.filter(series => series.platform !== null).map(series => <div key={series.platform} className="min-w-0"><h3 className="text-sm font-semibold text-foreground">{series.platform}</h3><SovChart data={series.points} lang={lang} label={series.platform ?? copy.aggregate} /></div>)}

        <section aria-labelledby="pulse-missed-heading">
          <h3 id="pulse-missed-heading" className="text-sm font-semibold text-foreground">{copy.missed}</h3>
          {view.missed.state !== 'ready'
            ? <p className="mt-2 text-sm text-muted-foreground">{view.missed.state === 'error' ? visibility.missedError : visibility.missedEmpty}</p>
            : <ul className="mt-2 divide-y divide-border">{view.missed.data.map((row, index) => <li key={`${row.platform}-${index}`} className="py-3 text-sm text-foreground first:pt-0 last:pb-0"><p>{row.question}</p><p className="mt-1 text-xs text-muted-foreground">{row.platform} · {row.scan_week}</p><p className="mt-1 text-xs text-muted-foreground">{copy.competitors}: {row.competitors_mentioned.join(', ') || copy.unknown}</p></li>)}</ul>}
        </section>
      </div>
    </details>
  </div>
}
