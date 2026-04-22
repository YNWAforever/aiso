'use client'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { PulseWeeklySummary } from '@/lib/types'

interface Props { data: PulseWeeklySummary[] }

export function SovChart({ data }: Props) {
  const chartData = data
    .filter(d => !d.platform)
    .map(d => ({ week: d.scan_week.slice(5), sov: Number(d.sov_score) }))

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={chartData}>
        <XAxis dataKey="week" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
        <Tooltip formatter={(v) => [`${v}%`]} />
        <Line type="monotone" dataKey="sov" stroke="#2563eb" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
