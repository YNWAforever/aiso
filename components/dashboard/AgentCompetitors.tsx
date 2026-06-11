import { useTranslations } from 'next-intl'
import type { AgentCompetitor } from '@/lib/types'

type Props = { competitors: AgentCompetitor[] }

function groupByPlatform(rows: AgentCompetitor[]): Record<string, AgentCompetitor[]> {
  const g: Record<string, AgentCompetitor[]> = {}
  for (const r of rows) { (g[r.platform] ??= []).push(r) }
  return g
}

export function AgentCompetitors({ competitors }: Props) {
  const t = useTranslations('dashboard')
  if (!competitors.length) {
    return (
      <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
        <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-1.5">{t('competitors_title')}</p>
        <p className="text-[11px] text-dash-muted/60 font-mono">{t('competitors_empty')}</p>
      </div>
    )
  }

  const grouped = groupByPlatform(competitors)

  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-4">{t('competitors_title')}</p>
      {Object.entries(grouped).map(([platform, rows]) => (
        <div key={platform} className="mb-3 last:mb-0">
          <p className="text-[10px] font-mono text-dash-danger tracking-wider uppercase mb-2">
            {platform.split('/').pop()}
          </p>
          <div className="space-y-1.5">
            {rows.slice(0, 3).map((r) => {
              const gap = r.mention_rate - r.your_rate
              return (
                <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-dash-elevated hover:bg-dash-border transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-medium text-dash-text truncate font-mono">
                        {r.competitor_name ?? r.competitor_domain}
                      </span>
                      <span className="text-[10px] font-mono font-semibold text-dash-danger ml-2 shrink-0">
                        {t('gap_label', { gap: gap.toFixed(0) })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex-1 h-1 rounded-full bg-dash-border overflow-hidden">
                        <div className="h-full rounded-full bg-dash-purple" style={{ width: `${r.your_rate}%` }} />
                      </div>
                      <div className="flex-1 h-1 rounded-full bg-dash-border overflow-hidden">
                        <div className="h-full rounded-full bg-dash-danger" style={{ width: `${r.mention_rate}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-dash-muted">{t('you_label', { rate: r.your_rate })}</span>
                      <span className="text-[9px] text-dash-muted">{t('them_label', { rate: r.mention_rate })}</span>
                    </div>
                    <p className="text-[11px] text-dash-muted/80 mt-1.5 leading-relaxed">{r.gap_analysis}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
