interface Row {
  platform: string
  question: string
  competitors_mentioned: string[]
  scan_week: string
}

interface Props {
  rows: Row[]
  platformLabel: string
  questionLabel: string
  competitorsLabel: string
}

export function MissedTable({ rows, platformLabel, questionLabel, competitorsLabel }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left py-2 pr-4 text-slate-500 font-medium">{platformLabel}</th>
            <th className="text-left py-2 pr-4 text-slate-500 font-medium">{questionLabel}</th>
            <th className="text-left py-2 text-slate-500 font-medium">{competitorsLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">{row.platform}</td>
              <td className="py-2 pr-4 text-slate-800">{row.question}</td>
              <td className="py-2 text-slate-500">{row.competitors_mentioned.join(', ') || '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={3} className="py-4 text-center text-slate-400">No data yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
