import type { AgentCompetitor } from '@/lib/types'

type Props = { competitors: AgentCompetitor[] }

function groupByPlatform(rows: AgentCompetitor[]): Record<string, AgentCompetitor[]> {
  const g: Record<string, AgentCompetitor[]> = {}
  for (const r of rows) { (g[r.platform] ??= []).push(r) }
  return g
}

export function AgentCompetitors({ competitors }: Props) {
  if (!competitors.length) {
    return (
      <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
        <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-1.5">Competitors</p>
        <p className="text-[11px] text-[#3c3c4e] font-mono">Competitor analysis will appear after agent analysis completes.</p>
      </div>
    )
  }

  const grouped = groupByPlatform(competitors)

  return (
    <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
      <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-4">Competitors</p>
      {Object.entries(grouped).map(([platform, rows]) => (
        <div key={platform} className="mb-3 last:mb-0">
          <p className="text-[10px] font-mono text-[#ef4444] tracking-wider uppercase mb-2">
            {platform.split('/').pop()}
          </p>
          <div className="space-y-1.5">
            {rows.slice(0, 3).map((r) => {
              const gap = r.mention_rate - r.your_rate
              return (
                <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-[#141422] hover:bg-[#1a1a2a] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-medium text-[#c0c0d0] truncate font-mono">
                        {r.competitor_name ?? r.competitor_domain}
                      </span>
                      <span className="text-[10px] font-mono font-semibold text-[#ef4444] ml-2 shrink-0">
                        +{gap.toFixed(0)}% gap
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-[#1e1e30] overflow-hidden">
                        <div className="h-full rounded-full bg-[#a78bfa]" style={{ width: `${r.your_rate}%` }} />
                      </div>
                      <div className="flex-1 h-1 rounded-full bg-[#1e1e30] overflow-hidden">
                        <div className="h-full rounded-full bg-[#ef4444]" style={{ width: `${r.mention_rate}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[9px] text-[#5c5c6e]">You {r.your_rate}%</span>
                      <span className="text-[9px] text-[#5c5c6e]">Them {r.mention_rate}%</span>
                    </div>
                    <p className="text-[11px] text-[#6c6c7e] mt-1.5 leading-relaxed">{r.gap_analysis}</p>
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
