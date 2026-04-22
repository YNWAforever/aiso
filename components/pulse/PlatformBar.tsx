'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { PulseWeeklySummary } from '@/lib/types'

interface Props { data: PulseWeeklySummary[] }

export function PlatformBar({ data }: Props) {
  const latest = data.at(-1)?.scan_week
  const chartData = data
    .filter(d => d.scan_week === latest && d.platform)
    .map(d => ({
      platform: d.platform!
        .replace('perplexity-sonar-pro', 'Perplx Pro')
        .replace('perplexity-sonar', 'Perplx')
        .replace('gpt-4o', 'GPT-4o')
        .replace('claude-haiku', 'Claude')
        .replace('gemini-flash', 'Gemini'),
      sov: Number(d.sov_score),
    }))

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={chartData} layout="vertical">
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
        <YAxis type="category" dataKey="platform" tick={{ fontSize: 11 }} width={70} />
        <Tooltip formatter={(v) => [`${v}%`]} />
        <Bar dataKey="sov" fill="#2563eb" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
