import type { AgentCompetitor } from '@/lib/types'

type Copy = {
  title: string
  empty: string
  mentionGap: string
}

const defaultCopy: Copy = {
  title: 'Local Competitor Snapshot',
  empty: 'Add competitors or run agent analysis to compare local trust gaps.',
  mentionGap: 'Mention gap',
}

type Props = {
  competitors: AgentCompetitor[]
  copy?: Partial<Copy>
}

export function CompetitorSnapshot({ competitors, copy }: Props) {
  const labels = { ...defaultCopy, ...copy }

  if (!competitors.length) {
    return (
      <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">{labels.title}</p>
        <p className="mt-2 text-xs leading-relaxed text-dash-muted">{labels.empty}</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">{labels.title}</p>
      <div className="mt-4 divide-y divide-dash-border overflow-hidden rounded-lg border border-dash-border">
        {competitors.slice(0, 5).map((row) => {
          const gap = row.mention_rate - row.your_rate

          return (
            <article key={`${row.platform}-${row.competitor_domain}`} className="bg-dash-elevated p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-dash-text">
                    {row.competitor_name ?? row.competitor_domain}
                  </p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-dash-muted">
                    {row.platform.split('/').pop()}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-xs font-semibold text-dash-muted">
                  {labels.mentionGap}: {gap.toFixed(0)} pts
                </p>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-dash-muted">{row.gap_analysis}</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
