import type { PulseWeeklySummary } from '@/lib/types'

interface Props {
  summary: PulseWeeklySummary[]
  brandName: string
  topN?: number
}

const COLORS = ['#f97316', '#a855f7', '#94a3b8', '#22c55e']
const BRAND_COLOR = '#3b82f6'

export function CompetitorChart({ summary, brandName, topN = 3 }: Props) {
  const aggRows = summary.filter(d => !d.platform).sort((a, b) => a.scan_week.localeCompare(b.scan_week))

  if (aggRows.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No data yet.</p>
  }

  const competitorTotals: Record<string, number> = {}
  for (const row of aggRows) {
    for (const [name, count] of Object.entries(row.top_competitors ?? {})) {
      competitorTotals[name] = (competitorTotals[name] ?? 0) + count
    }
  }
  const topCompetitors = Object.entries(competitorTotals)
    .sort((a, b) => b[1] - a[1]).slice(0, topN).map(([name]) => name)

  const weeks = aggRows.map(d => d.scan_week)
  const weekCount = weeks.length
  const W = 460, H = 140, PAD_L = 36, PAD_B = 20, PAD_T = 10
  const chartW = W - PAD_L, chartH = H - PAD_B - PAD_T
  const toX = (i: number) => PAD_L + (i / Math.max(weekCount - 1, 1)) * chartW
  const toY = (pct: number) => PAD_T + chartH - (pct / 100) * chartH

  const brandPoints = aggRows.map((d, i) => `${toX(i)},${toY(d.sov_score)}`).join(' ')
  const competitorPointsMap = topCompetitors.map(name =>
    aggRows.map((d, i) => {
      const count = d.top_competitors?.[name] ?? 0
      const rate  = d.total_queries > 0 ? (count / d.total_queries) * 100 : 0
      return `${toX(i)},${toY(rate)}`
    }).join(' ')
  )

  const labelIndices = weekCount <= 6
    ? Array.from({ length: weekCount }, (_, i) => i)
    : [0, Math.round(weekCount * 0.2), Math.round(weekCount * 0.4),
       Math.round(weekCount * 0.6), Math.round(weekCount * 0.8), weekCount - 1]

  const formatWeek = (w: string) => {
    const d = new Date(w)
    return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`
  }

  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className="inline-block w-4 h-0.5 bg-blue-500" />{brandName}
        </div>
        {topCompetitors.map((name, i) => (
          <div key={name} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block w-4 h-0.5" style={{ background: COLORS[i] }} />{name}
          </div>
        ))}
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
        {[0, 25, 50, 75, 100].map(pct => (
          <g key={pct}>
            <line x1={PAD_L} y1={toY(pct)} x2={W} y2={toY(pct)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={PAD_L - 4} y={toY(pct) + 3} fontSize={7} fill="#94a3b8" textAnchor="end">{pct}%</text>
          </g>
        ))}
        {labelIndices.map(i => (
          <text key={i} x={toX(i)} y={H - 4} fontSize={7} fill="#94a3b8" textAnchor="middle">
            {formatWeek(weeks[i])}
          </text>
        ))}
        {competitorPointsMap.map((pts, i) => (
          <polyline key={topCompetitors[i]} points={pts} fill="none"
            stroke={COLORS[i]} strokeWidth={1.5} strokeLinejoin="round" />
        ))}
        <polyline points={brandPoints} fill="none"
          stroke={BRAND_COLOR} strokeWidth={2.5} strokeLinejoin="round" />
        {aggRows.length > 0 && (
          <circle cx={toX(aggRows.length - 1)} cy={toY(aggRows.at(-1)!.sov_score)}
            r={3.5} fill={BRAND_COLOR} />
        )}
      </svg>
    </div>
  )
}
