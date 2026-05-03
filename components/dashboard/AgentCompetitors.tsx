import type { AgentCompetitor } from '@/lib/types'

type Props = {
  competitors: AgentCompetitor[]
}

function groupByPlatform(rows: AgentCompetitor[]): Record<string, AgentCompetitor[]> {
  const grouped: Record<string, AgentCompetitor[]> = {}
  for (const r of rows) {
    if (!grouped[r.platform]) grouped[r.platform] = []
    grouped[r.platform].push(r)
  }
  return grouped
}

export function AgentCompetitors({ competitors }: Props) {
  if (competitors.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-700 mb-1">Competitors</p>
        <p className="text-xs text-slate-400">Competitor analysis will appear after agent analysis completes.</p>
      </div>
    )
  }

  const grouped = groupByPlatform(competitors)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-sm font-semibold text-slate-700 mb-3">Competitors</p>
      {Object.entries(grouped).map(([platform, rows]) => (
        <div key={platform} className="mb-3 last:mb-0">
          <p className="text-xs font-medium text-slate-500 mb-2 uppercase">{platform.split('/').pop()}</p>
          <div className="space-y-2">
            {rows.slice(0, 3).map((r) => (
              <div key={r.id} className="flex items-start gap-3 p-2 rounded-lg bg-slate-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-slate-800 truncate">
                      {r.competitor_name ?? r.competitor_domain}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-slate-400">You: {r.your_rate}%</span>
                      <span className="text-[10px] font-semibold text-red-500">Them: {r.mention_rate}%</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{r.gap_analysis}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
