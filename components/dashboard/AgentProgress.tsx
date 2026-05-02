import type { AgentProgress } from '@/lib/types'

type Props = {
  progress: AgentProgress[]
}

function formatDelta(delta: number | null): { text: string; color: string } {
  if (delta === null || delta === undefined) return { text: '—', color: 'text-slate-400' }
  if (delta > 0) return { text: `+${delta.toFixed(1)}`, color: 'text-emerald-600' }
  if (delta < 0) return { text: delta.toFixed(1), color: 'text-red-500' }
  return { text: '0.0', color: 'text-slate-400' }
}

function groupByPlatform(rows: AgentProgress[]): Record<string, AgentProgress[]> {
  const grouped: Record<string, AgentProgress[]> = {}
  for (const r of rows) {
    if (!grouped[r.platform]) grouped[r.platform] = []
    grouped[r.platform].push(r)
  }
  return grouped
}

export function AgentProgress({ progress }: Props) {
  if (progress.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-700 mb-1">Progress</p>
        <p className="text-xs text-slate-400">Progress tracking will appear after your next scan.</p>
      </div>
    )
  }

  const grouped = groupByPlatform(progress)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-sm font-semibold text-slate-700 mb-3">Progress</p>
      {Object.entries(grouped).map(([platform, rows]) => (
        <div key={platform} className="mb-3 last:mb-0">
          <p className="text-xs font-medium text-slate-500 mb-2 uppercase">{platform.split('/').pop()}</p>
          <div className="space-y-1.5">
            {rows.map((r) => {
              const delta = formatDelta(r.delta)
              return (
                <div key={r.id} className="flex items-center justify-between">
                  <span className="text-xs text-slate-700 capitalize">{r.metric.replace(/_/g, ' ')}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-900">{r.current_value}</span>
                    <span className={`text-[10px] font-medium ${delta.color}`}>{delta.text}</span>
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
