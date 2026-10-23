import { BellRing, BellOff, Radio } from 'lucide-react'
import { PlatformDots } from '@/components/visuals/PlatformDots'
import { RevealObserver } from '@/components/visuals/reveal/RevealObserver'
import { buildCompetitorBars, buildPlatformGrid, monitorStatus } from '@/lib/view-models/monitor-signals'
import type { PulseView } from '@/lib/view-models/pulse'
import { cn } from '@/lib/utils'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

const panel = 'min-w-0 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'

/**
 * Monitor's top: how fresh the weekly results are (not whether a schedule
 * runs: a manual run also makes them fresh), then
 * platform × week, brand vs competitors, and alert status. Every panel reads
 * stored rows only, and says so plainly when there are none.
 */
export function MonitorSignals({ view, lang, now }: { view: PulseView; lang: string; now: Date }) {
  const copy = (lang === 'zh-HK' ? zhHK : en).pulseView.signals
  const status = monitorStatus(view.observations.latestWeek, now)
  const grid = view.observations.state === 'error' ? null : buildPlatformGrid(view.observations.series)
  const bars = view.competitors?.state === 'ready' ? buildCompetitorBars(view.competitors.data) : null
  const alerts = view.alerts
  const fmtWeek = (week: string) => week.slice(5)

  return (
    <div className="space-y-5" data-reveal>
      <RevealObserver />
      <div
        role="status"
        data-testid="monitor-status"
        className={cn('flex items-start gap-3 rounded-2xl border p-4', status.state === 'fresh' ? 'border-tone-success/40 bg-tone-success-soft' : 'border-tone-warning/40 bg-tone-warning-soft')}
      >
        <Radio aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', status.state === 'fresh' ? 'text-tone-success-fg' : 'text-tone-warning-fg')} />
        <div>
          <p className={cn('font-semibold', status.state === 'fresh' ? 'text-tone-success-fg' : 'text-tone-warning-fg')}>
            {status.state === 'fresh' ? copy.status.fresh.replace('{week}', status.lastWeek!) : status.state === 'stale' ? copy.status.stale.replace('{week}', status.lastWeek!) : copy.status.never}
          </p>
          <p className={cn('text-sm', status.state === 'fresh' ? 'text-tone-success-fg' : 'text-tone-warning-fg')}>{copy.status.body}</p>
        </div>
      </div>

      <section className={panel} aria-labelledby="platform-grid-heading">
        <h2 id="platform-grid-heading" className="text-lg font-bold text-foreground">{copy.platforms.title}</h2>
        {grid
          ? <PlatformDots className="mt-4" platforms={grid.platforms} weeks={grid.weeks.map(fmtWeek)} cells={grid.cells} caption={copy.platforms.caption} />
          : <p className="mt-2 text-sm text-muted-foreground">{copy.platforms.empty}</p>}
      </section>

      {view.competitors && (
        <section className={panel} aria-labelledby="competitor-bars-heading">
          <h2 id="competitor-bars-heading" className="text-lg font-bold text-foreground">{copy.competitors.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.competitors.caption}</p>
          {bars
            ? <ul className="mt-4 space-y-3" data-testid="competitor-bars">
                {bars.map((bar, index) => {
                  const name = bar.name ?? copy.competitors.you.replace('{brand}', view.client.brand_name)
                  return (
                    <li key={bar.name ?? '__brand'}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className={cn('truncate', bar.name === null ? 'font-bold text-foreground' : 'text-foreground')}>{name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{copy.competitors.share.replace('{n}', String(bar.share))}</span>
                      </div>
                      <div aria-hidden="true" className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-3">
                        <div
                          className={cn('reveal-bar h-full rounded-full', bar.name === null ? 'bg-primary' : 'bg-neutral-8')}
                          style={{ ['--to' as string]: Math.min(1, bar.share / 100), ['--reveal-delay' as string]: `${index * 60}ms` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            : <p className="mt-3 text-sm text-muted-foreground">{copy.competitors.empty}</p>}
        </section>
      )}

      {alerts && (
        <section className={cn(panel, 'flex items-center gap-3')} aria-labelledby="alert-status-heading" data-testid="alert-status">
          {alerts.state === 'ready' && alerts.data.enabled
            ? <BellRing aria-hidden="true" className="size-5 shrink-0 text-primary-accessible" />
            : <BellOff aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <h2 id="alert-status-heading" className="text-sm font-bold text-foreground">
              {copy.alerts.title}: {alerts.state === 'error' ? '—' : alerts.data.enabled ? copy.alerts.on : copy.alerts.off}
            </h2>
            <p className="text-sm text-muted-foreground">
              {alerts.state === 'error' ? copy.alerts.error : alerts.data.lastAt ? copy.alerts.last.replace('{date}', alerts.data.lastAt.slice(0, 10)) : copy.alerts.none}
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
