import type { OverviewStats } from '@/lib/view-models/overview-stats'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

const W = 600
const H = 160

/**
 * Score per stored scan, oldest to newest, on the fixed 0–100 scale so a small
 * move never looks like a cliff. Plain SVG (no chart library on the dashboard's
 * first load). The plot stretches to its box, so labels are HTML and keep their
 * size on a phone; strokes do not scale. It grows in from the left once, on
 * reveal (transform only), and a visually hidden table carries every value.
 */
export function ScoreTrend({ trend, lang }: { trend: OverviewStats['trend']; lang: string }) {
  const copy = (lang === 'zh-HK' ? zhHK : en).workspaceHome.trend
  const day = (iso: string) => iso.slice(0, 10)
  if (trend.length < 2) {
    return (
      <section aria-labelledby="score-trend-heading" className="mb-8 rounded-2xl border border-dash-border bg-dash-surface p-5 shadow-sm sm:p-6">
        <h2 id="score-trend-heading" className="text-lg font-bold text-dash-text">{copy.title}</h2>
        <p className="mt-2 text-sm text-dash-muted">{copy.empty}</p>
      </section>
    )
  }
  const x = (i: number) => (W * i) / (trend.length - 1)
  const y = (score: number) => H * (1 - Math.max(0, Math.min(100, score)) / 100)
  const line = trend.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ')
  const first = trend[0]!, last = trend[trend.length - 1]!
  const summary = copy.summary.replace('{first}', String(first.score)).replace('{last}', String(last.score)).replace('{count}', String(trend.length))

  return (
    <section aria-labelledby="score-trend-heading" className="mb-8 rounded-2xl border border-dash-border bg-dash-surface p-5 shadow-sm sm:p-6" data-reveal>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="score-trend-heading" className="text-lg font-bold text-dash-text">{copy.title}</h2>
        <p className="text-sm font-semibold tabular-nums text-dash-text">{first.score} → {last.score}</p>
      </div>
      <div className="mt-4 flex gap-2">
        <div aria-hidden="true" className="flex h-40 flex-col justify-between text-right text-xs tabular-nums text-dash-muted"><span>100</span><span>50</span><span>0</span></div>
        <div className="min-w-0 flex-1">
          <div className="reveal-line-x h-40">
            <svg role="img" aria-label={summary} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="size-full overflow-visible">
              {[0, 50, 100].map(v => <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} strokeWidth={1} vectorEffect="non-scaling-stroke" className="stroke-dash-border" />)}
              <path d={line} fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="stroke-primary" />
            </svg>
          </div>
          <div aria-hidden="true" className="mt-1 flex justify-between text-xs tabular-nums text-dash-muted"><span>{day(first.date)}</span><span>{day(last.date)}</span></div>
        </div>
      </div>
      <table className="sr-only">
        <caption>{copy.title}</caption>
        <thead><tr><th scope="col">{copy.date}</th><th scope="col">{copy.score}</th></tr></thead>
        <tbody>{trend.map(p => <tr key={p.id}><td>{day(p.date)}</td><td>{p.score}</td></tr>)}</tbody>
      </table>
    </section>
  )
}
