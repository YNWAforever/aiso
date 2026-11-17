import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/ui/stat-card'
import { MonitorSignals } from '@/components/pulse/MonitorSignals'
import { PulseCoverage } from '@/components/pulse/PulseCoverage'
import { RunProgress } from '@/components/pulse/RunProgress'
import { SovChart } from '@/components/pulse/SovChart'
import { monitorStatus } from '@/lib/view-models/monitor-signals'
import { buildVisibilityOverview } from '@/lib/view-models/visibility-summary'
import type { PulseView } from '@/lib/view-models/pulse'
import { cn } from '@/lib/utils'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/**
 * The first "What AI says" tab. One primary card answers "is AI mentioning us,
 * and is that changing?", then supports it with three numbers, the weekly run
 * controls, platform/competitor evidence and the questions the brand was absent
 * from. All numbers come from saved, classified answers; empty and error states
 * are deliberately distinct from a measured zero.
 */
export function VisibilityView({ view, lang, now }: { view: PulseView; lang: string; now: Date }) {
  const messages = lang === 'zh-HK' ? zhHK : en
  const copy = messages.pulseView.visibility
  const baseCopy = messages.pulseView
  const base = `/${lang}/dashboard/${encodeURIComponent(view.client.id)}`
  const overview = buildVisibilityOverview(view)
  const status = monitorStatus(view.observations.latestWeek, now)
  const hasNumbers = overview.state === 'ready' || overview.state === 'partial'
  const delta = overview.delta
  const deltaText = delta === null
    ? copy.noComparison
    : delta > 0
      ? copy.deltaUp.replace('{delta}', String(delta))
      : delta < 0
        ? copy.deltaDown.replace('{delta}', String(Math.abs(delta)))
        : copy.deltaFlat
  const freshness = status.state === 'fresh'
    ? copy.freshWeek.replace('{week}', status.lastWeek ?? '')
    : status.state === 'stale'
      ? copy.staleWeek.replace('{week}', status.lastWeek ?? '')
      : copy.never

  return (
    <div className="min-w-0 space-y-6">
      <section className="rounded-2xl border border-border bg-card p-5 shadow-e2 sm:p-6" aria-labelledby="visibility-headline">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id="visibility-headline" className="text-sm font-semibold text-muted-foreground">{copy.mentionRate}</h2>
            <p className={cn('mt-2 text-5xl font-black tracking-tight tabular-nums text-foreground', !hasNumbers && 'text-xl font-semibold text-muted-foreground')}>
              {overview.sov === null ? baseCopy.unknown : `${Number(overview.sov.toFixed(1))}%`}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <span className={cn(
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
              status.state === 'fresh' ? 'bg-tone-success-soft text-tone-success-fg' : 'bg-tone-warning-soft text-tone-warning-fg',
            )}>
              {freshness}
            </span>
            {hasNumbers && (
              <span className={cn(
                'text-sm font-semibold tabular-nums',
                delta === null || delta === 0 ? 'text-muted-foreground' : delta > 0 ? 'text-tone-success-fg' : 'text-tone-danger-fg',
              )}>
                {deltaText}
              </span>
            )}
          </div>
        </div>

        {overview.state === 'error' ? (
          <p role="alert" className="mt-5 rounded-xl border border-tone-danger/40 bg-tone-danger-soft p-3 text-sm text-tone-danger-fg">
            {(lang === 'zh-HK' ? zhHK : en).pulseView.error}
          </p>
        ) : overview.state === 'empty' ? (
          <div className="mt-5 rounded-xl border border-dashed border-border bg-muted/30 p-4">
            <p className="text-sm font-semibold text-foreground">{copy.emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{copy.emptyBody}</p>
          </div>
        ) : (
          <>
            <PulseCoverage
              coverage={overview.coverage}
              lang={lang}
              href={`${base}/observations?result=incomplete`}
            />
            {overview.state === 'partial' && (
              <p className="mt-2 text-sm font-semibold text-tone-warning-fg">{(lang === 'zh-HK' ? zhHK : en).pulseView.partial}</p>
            )}
            {overview.trend.length > 1 && <SovChart data={overview.trend} lang={lang} />}
          </>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {hasNumbers && (
            <Button asChild className="min-h-11"><Link href={`${base}/observations`}>{copy.viewAnswers}</Link></Button>
          )}
          <Button asChild variant={hasNumbers ? 'outline' : 'default'} className="min-h-11"><Link href={`${base}/prompts`}>{copy.manageQuestions}</Link></Button>
        </div>
      </section>

      <section aria-label={copy.statsLabel} className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatCard
          label={copy.platforms}
          value={hasNumbers ? String(overview.platformCount) : '—'}
          href="#platform-grid-heading"
          compactOnMobile
        />
        <StatCard
          label={copy.questions}
          value={overview.activeQuestions === null ? '—' : String(overview.activeQuestions)}
          href={`${base}/prompts`}
          compactOnMobile
        />
        <StatCard
          label={copy.missed}
          value={hasNumbers ? String(overview.missedGroups.length) : '—'}
          href={`${base}/observations`}
          compactOnMobile
        />
      </section>

      <section className="scroll-mt-24">
        <RunProgress clientId={view.client.id} lang={lang} smeCopilot brandName={view.client.brand_name} />
      </section>

      <MonitorSignals view={view} lang={lang} now={now} showStatus={false} />

      {view.missed.state === 'error' ? (
        <p role="alert" className="rounded-xl border border-tone-danger/40 bg-tone-danger-soft p-3 text-sm text-tone-danger-fg">
          {copy.missedError}
        </p>
      ) : overview.missedGroups.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="missed-heading">
          <h2 id="missed-heading" className="text-lg font-bold text-foreground">{copy.missedTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.missedCaption}</p>
          <ul className="mt-4 divide-y divide-border">
            {overview.missedGroups.slice(0, 3).map(group => (
              <li key={group.question} className="py-3 first:pt-0 last:pb-0">
                <p className="min-w-0 text-sm font-semibold text-foreground">{group.question}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {group.platforms.join(' · ')}
                  {group.competitors.length > 0 && ` · ${copy.namedCompetitors.replace('{names}', group.competitors.slice(0, 3).join(', '))}`}
                </p>
              </li>
            ))}
          </ul>
          <Link href={`${base}/observations`} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline">
            {copy.missedMore}
          </Link>
        </section>
      ) : hasNumbers ? (
        <p className="rounded-xl border border-tone-success/30 bg-tone-success-soft p-4 text-sm text-tone-success-fg">{copy.missedEmpty}</p>
      ) : null}
    </div>
  )
}
