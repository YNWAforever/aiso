import { useTranslations } from 'next-intl'
import type { AgentRecommendation } from '@/lib/types'

type Props = { recommendations: AgentRecommendation[] }

function groupByPlatform(recs: AgentRecommendation[]): Record<string, AgentRecommendation[]> {
  const g: Record<string, AgentRecommendation[]> = {}
  for (const r of recs) { (g[r.platform] ??= []).push(r) }
  return g
}

export function AgentRecommendations({ recommendations }: Props) {
  const t = useTranslations('dashboard')
  if (!recommendations.length) {
    return (
      <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
        <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-1.5">{t('recs_title')}</p>
        <p className="text-[11px] text-dash-muted/60 font-mono">{t('recs_empty')}</p>
      </div>
    )
  }

  const grouped = groupByPlatform(recommendations)

  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-4">{t('recs_title')}</p>
      {Object.entries(grouped).map(([platform, recs]) => (
        <div key={platform} className="mb-4 last:mb-0">
          <p className="text-[10px] font-mono text-dash-accent tracking-wider uppercase mb-2.5">
            {platform.split('/').pop()}
          </p>
          <div className="space-y-2">
            {recs.slice(0, 4).map((r) => (
              <div key={r.id} className="flex items-start gap-2.5 group">
                <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                  r.priority === 'high' ? 'bg-destructive' : r.priority === 'medium' ? 'bg-dash-warning' : 'bg-dash-muted'
                }`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-dash-text/90 leading-relaxed">{r.recommendation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
