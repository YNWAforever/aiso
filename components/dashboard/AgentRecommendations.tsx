import type { AgentRecommendation } from '@/lib/types'

type Props = {
  recommendations: AgentRecommendation[]
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
}

function groupByPlatform(recs: AgentRecommendation[]): Record<string, AgentRecommendation[]> {
  const grouped: Record<string, AgentRecommendation[]> = {}
  for (const r of recs) {
    if (!grouped[r.platform]) grouped[r.platform] = []
    grouped[r.platform].push(r)
  }
  return grouped
}

export function AgentRecommendations({ recommendations }: Props) {
  if (recommendations.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-700 mb-1">Recommendations</p>
        <p className="text-xs text-slate-400">No recommendations yet. Agent analysis will provide platform-specific fixes.</p>
      </div>
    )
  }

  const grouped = groupByPlatform(recommendations)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-sm font-semibold text-slate-700 mb-3">Recommendations</p>
      {Object.entries(grouped).map(([platform, recs]) => (
        <div key={platform} className="mb-3 last:mb-0">
          <p className="text-xs font-medium text-slate-500 mb-2 uppercase">{platform.split('/').pop()}</p>
          <div className="space-y-1.5">
            {recs.slice(0, 3).map((r) => (
              <div key={r.id} className="flex items-start gap-2">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 mt-0.5 ${PRIORITY_COLORS[r.priority] ?? PRIORITY_COLORS.low}`}>
                  {r.priority}
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-slate-800 leading-relaxed">{r.recommendation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
