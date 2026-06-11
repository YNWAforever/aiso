import { useTranslations } from 'next-intl'
import type { AgentProgress } from '@/lib/types'

type Props = { progress: AgentProgress[] }

function groupByPlatform(rows: AgentProgress[]): Record<string, AgentProgress[]> {
  const g: Record<string, AgentProgress[]> = {}
  for (const r of rows) { (g[r.platform] ??= []).push(r) }
  return g
}

export function AgentProgress({ progress }: Props) {
  const t = useTranslations('dashboard')
  if (!progress.length) {
    return (
      <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
        <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-1.5">{t('progress_title')}</p>
        <p className="text-[11px] text-dash-muted/60 font-mono">{t('progress_empty')}</p>
      </div>
    )
  }

  const grouped = groupByPlatform(progress)

  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-4">{t('progress_title')}</p>
      {Object.entries(grouped).map(([platform, rows]) => (
        <div key={platform} className="mb-3 last:mb-0">
          <p className="text-[10px] font-mono text-dash-purple tracking-wider uppercase mb-2">
            {platform.split('/').pop()}
          </p>
          <div className="space-y-1.5">
            {rows.map((r) => {
              const delta = r.delta
              const isUp = delta !== null && delta !== undefined && delta > 0
              const isDown = delta !== null && delta !== undefined && delta < 0
              return (
                <div key={r.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-dash-elevated transition-colors">
                  <span className="text-[11px] text-dash-muted font-mono capitalize">{r.metric.replace(/_/g, ' ')}</span>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-xs font-semibold text-dash-text">{r.current_value}</span>
                    {delta !== null && delta !== undefined && (
                      <span className={`text-[10px] font-medium ${isUp ? 'text-dash-success' : isDown ? 'text-dash-danger' : 'text-dash-muted'}`}>
                        {isUp ? '+' : ''}{delta.toFixed(1)}
                      </span>
                    )}
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
