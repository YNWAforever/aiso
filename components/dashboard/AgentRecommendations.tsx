import type { AgentRecommendation } from '@/lib/types'

type Props = { recommendations: AgentRecommendation[] }

const PRIORITY: Record<string, { bg: string; text: string; dot: string }> = {
  high:   { bg: '#ef444412', text: '#ef4444', dot: '#ef4444' },
  medium: { bg: '#f59e0b12', text: '#f59e0b', dot: '#f59e0b' },
  low:    { bg: '#5c5c6e12', text: '#5c5c6e', dot: '#5c5c6e' },
}

function groupByPlatform(recs: AgentRecommendation[]): Record<string, AgentRecommendation[]> {
  const g: Record<string, AgentRecommendation[]> = {}
  for (const r of recs) { (g[r.platform] ??= []).push(r) }
  return g
}

export function AgentRecommendations({ recommendations }: Props) {
  if (!recommendations.length) {
    return (
      <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
        <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-1.5">Recommendations</p>
        <p className="text-[11px] text-[#3c3c4e] font-mono">No recommendations yet — agents will provide platform-specific fixes.</p>
      </div>
    )
  }

  const grouped = groupByPlatform(recommendations)

  return (
    <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
      <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-4">Recommendations</p>
      {Object.entries(grouped).map(([platform, recs]) => (
        <div key={platform} className="mb-4 last:mb-0">
          <p className="text-[10px] font-mono text-[#00d4ff] tracking-wider uppercase mb-2.5">
            {platform.split('/').pop()}
          </p>
          <div className="space-y-2">
            {recs.slice(0, 4).map((r) => {
              const p = PRIORITY[r.priority] ?? PRIORITY.low
              return (
                <div key={r.id} className="flex items-start gap-2.5 group">
                  <span className="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.dot }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-[#c0c0d0] leading-relaxed">{r.recommendation}</p>
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
