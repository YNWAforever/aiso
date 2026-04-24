import type { PulseWeeklySummary } from '@/lib/types'
import { CompetitorChart } from './CompetitorChart'

interface Props {
  summary: PulseWeeklySummary[]
  brandName: string
}

export function CompetitorTab({ summary, brandName }: Props) {
  const aggRows = summary.filter(d => !d.platform).sort((a, b) => a.scan_week.localeCompare(b.scan_week))
  const latest  = aggRows.at(-1)
  const prev    = aggRows.at(-2)

  if (aggRows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-400">No pulse data yet. Competitor data will appear after the first scan run.</p>
      </div>
    )
  }

  const topCompetitors = Object.entries(latest?.top_competitors ?? {})
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
  const prevCompetitors = Object.fromEntries(Object.entries(prev?.top_competitors ?? {}))
  const ICONS = ['🟠','🟣','⚪','🟡','🔴']

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <p className="text-sm font-semibold text-slate-700 mb-1">Mention Rate Trend</p>
        <p className="text-xs text-slate-400 mb-4">% of queries where brand/competitor was mentioned · last {aggRows.length} weeks</p>
        <CompetitorChart summary={summary} brandName={brandName} />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <p className="text-sm font-semibold text-slate-700 mb-4">Latest Week Summary</p>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-slate-400">
              <th className="text-left py-2 font-semibold">Brand</th>
              <th className="text-right py-2 font-semibold">Mention Rate</th>
              <th className="text-right py-2 font-semibold">vs Last Week</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100 font-semibold">
              <td className="py-2 text-slate-900">🔵 {brandName}</td>
              <td className="text-right text-slate-900">{latest?.sov_score ?? '—'}%</td>
              <td className="text-right">
                {prev && latest ? (
                  <span className={latest.sov_score > prev.sov_score ? 'text-green-600' : latest.sov_score < prev.sov_score ? 'text-red-500' : 'text-slate-400'}>
                    {latest.sov_score > prev.sov_score ? '+' : ''}{latest.sov_score - prev.sov_score}%
                  </span>
                ) : '—'}
              </td>
            </tr>
            {topCompetitors.map(([name, count], i) => {
              const prevCount = prevCompetitors[name] ?? 0
              const totalQ    = latest?.total_queries ?? 1
              const rate      = Math.round((count / totalQ) * 100)
              const prevRate  = prev ? Math.round((prevCount / (prev.total_queries || 1)) * 100) : null
              return (
                <tr key={name} className="border-t border-slate-100">
                  <td className="py-2 text-slate-500">{ICONS[i] ?? '•'} {name}</td>
                  <td className="text-right text-slate-500">{rate}%</td>
                  <td className="text-right">
                    {prevRate !== null ? (
                      <span className={rate > prevRate ? 'text-red-400' : rate < prevRate ? 'text-green-600' : 'text-slate-400'}>
                        {rate > prevRate ? '+' : ''}{rate - prevRate}%
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
