import type { AgentProgress } from '@/lib/types'

type Props = { progress: AgentProgress[] }

function groupByPlatform(rows: AgentProgress[]): Record<string, AgentProgress[]> {
  const g: Record<string, AgentProgress[]> = {}
  for (const r of rows) { (g[r.platform] ??= []).push(r) }
  return g
}

export function AgentProgress({ progress }: Props) {
  if (!progress.length) {
    return (
      <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
        <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-1.5">Progress</p>
        <p className="text-[11px] text-[#3c3c4e] font-mono">Progress tracking will appear after your next scan.</p>
      </div>
    )
  }

  const grouped = groupByPlatform(progress)

  return (
    <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
      <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-4">Progress</p>
      {Object.entries(grouped).map(([platform, rows]) => (
        <div key={platform} className="mb-3 last:mb-0">
          <p className="text-[10px] font-mono text-[#a78bfa] tracking-wider uppercase mb-2">
            {platform.split('/').pop()}
          </p>
          <div className="space-y-1.5">
            {rows.map((r) => {
              const delta = r.delta
              const isUp = delta !== null && delta !== undefined && delta > 0
              const isDown = delta !== null && delta !== undefined && delta < 0
              return (
                <div key={r.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-[#141422] transition-colors">
                  <span className="text-[11px] text-[#8c8c9e] font-mono capitalize">{r.metric.replace(/_/g, ' ')}</span>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-xs font-semibold text-[#e0e0ec]">{r.current_value}</span>
                    {delta !== null && delta !== undefined && (
                      <span className="text-[10px] font-medium" style={{ color: isUp ? '#22c55e' : isDown ? '#ef4444' : '#5c5c6e' }}>
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
