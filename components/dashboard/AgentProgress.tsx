import type { AgentProgress } from '@/lib/types'

type Props = { progress: AgentProgress[] }

function groupByPlatform(rows: AgentProgress[]): Record<string, AgentProgress[]> {
  const g: Record<string, AgentProgress[]> = {}
  for (const r of rows) { (g[r.platform] ??= []).push(r) }
  return g
}

/**
 * Saved measured progress for a scan. The surrounding Improve section owns the
 * empty and locked states; a completed receipt with no rows renders nothing
 * here rather than a second empty card.
 */
export function AgentProgress({ progress }: Props) {
  if (!progress.length) return null

  const grouped = groupByPlatform(progress)

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {Object.entries(grouped).map(([platform, rows]) => (
        <div key={platform} className="mb-4 last:mb-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{platform.split('/').pop()}</p>
          <div className="mt-2 space-y-1.5">
            {rows.map((r) => {
              const delta = r.delta
              const isUp = delta !== null && delta !== undefined && delta > 0
              const isDown = delta !== null && delta !== undefined && delta < 0
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5">
                  <span className="min-w-0 text-sm capitalize text-muted-foreground">{r.metric.replace(/_/g, ' ')}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{r.current_value}</span>
                    {delta !== null && delta !== undefined ? (
                      <span className={`text-xs font-medium ${isUp ? 'text-tone-success-fg' : isDown ? 'text-tone-danger-fg' : 'text-muted-foreground'}`}>
                        {isUp ? '+' : ''}{delta.toFixed(1)}
                      </span>
                    ) : null}
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
