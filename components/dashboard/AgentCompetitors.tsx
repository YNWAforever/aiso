import { useTranslations } from 'next-intl'
import type { AgentCompetitor } from '@/lib/types'

type Props = { competitors: AgentCompetitor[] }

function groupByPlatform(rows: AgentCompetitor[]): Record<string, AgentCompetitor[]> {
  const g: Record<string, AgentCompetitor[]> = {}
  for (const r of rows) { (g[r.platform] ??= []).push(r) }
  return g
}

/**
 * Saved sourced competitor measurements. The surrounding Improve section owns
 * the empty and locked states, so an empty list renders nothing here.
 */
export function AgentCompetitors({ competitors }: Props) {
  const t = useTranslations('dashboard')
  if (!competitors.length) return null

  const grouped = groupByPlatform(competitors)

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {Object.entries(grouped).map(([platform, rows]) => (
        <div key={platform} className="mb-4 last:mb-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{platform.split('/').pop()}</p>
          <div className="mt-2 space-y-2">
            {rows.slice(0, 3).map((r) => {
              const gap = r.mention_rate - r.your_rate
              return (
                <div key={r.id} className="rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-foreground">{r.competitor_name ?? r.competitor_domain}</span>
                    <span className="shrink-0 text-xs font-semibold text-tone-danger-fg">{t('gap_label', { gap: gap.toFixed(0) })}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${r.your_rate}%` }} />
                    </div>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                      <div className="h-full rounded-full bg-tone-danger" style={{ width: `${r.mention_rate}%` }} />
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{t('you_label', { rate: r.your_rate })}</span>
                    <span className="text-xs text-muted-foreground">{t('them_label', { rate: r.mention_rate })}</span>
                  </div>
                  <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">{r.gap_analysis}</p>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
