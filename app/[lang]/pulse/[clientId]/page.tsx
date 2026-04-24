import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { supabase }    from '@/lib/supabase'
import { SovChart }    from '@/components/pulse/SovChart'
import { PlatformBar } from '@/components/pulse/PlatformBar'
import { MissedTable } from '@/components/pulse/MissedTable'
import type { PulseWeeklySummary, PulseMetric } from '@/lib/types'

export default async function PulsePage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { clientId } = await params
  const t = await getTranslations('pulse')

  const { data: clientData } = await supabase.from('clients').select('brand_name').eq('id', clientId).single()
  const client = clientData as { brand_name: string } | null
  if (!client) notFound()

  const [{ data: summaryRaw }, { data: missedRaw }] = await Promise.all([
    supabase.from('pulse_weekly_summary').select('*').eq('client_id', clientId).order('scan_week').limit(40),
    supabase.from('pulse_metrics').select('platform,question,competitors_mentioned,scan_week').eq('client_id', clientId).eq('brand_mentioned', false).order('scan_week', { ascending: false }).limit(50),
  ])

  const summary = (summaryRaw ?? []) as PulseWeeklySummary[]
  const missed  = (missedRaw  ?? []) as PulseMetric[]

  const latestWeek = summary.at(-1)?.scan_week
  const kpi = summary.find(d => d.scan_week === latestWeek && !d.platform)

  const sentimentLabel = (s: number | undefined) => {
    if (s === undefined || s === null) return '—'
    if (s > 0.3)  return t('sentiment_positive')
    if (s < -0.3) return t('sentiment_negative')
    return t('sentiment_neutral')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <span className="font-bold text-slate-900">
          Fimmick <span className="text-blue-600">{t('title')}</span>
          <span className="ml-2 text-sm font-normal text-slate-500">{client.brand_name}</span>
        </span>
        <span className="text-xs text-slate-400">
          {kpi?.scan_week ? `Week of ${kpi.scan_week}` : 'No data yet'}
        </span>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t('sov'),       value: kpi ? `${kpi.sov_score}%` : '—' },
            { label: t('mentions'),  value: kpi ? `${kpi.brand_mentions}/${kpi.total_queries}` : '—' },
            { label: t('sentiment'), value: sentimentLabel(kpi?.avg_sentiment_score) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-5 text-center">
              <p className="text-2xl font-black text-blue-600">{value}</p>
              <p className="text-xs text-slate-500 mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* SoV Trend */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-700 mb-4">{t('sov_trend')}</p>
          <SovChart data={summary} />
        </div>

        {/* Platform Breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-700 mb-4">{t('platform_breakdown')}</p>
          <PlatformBar data={summary} />
        </div>

        {/* Missed Opportunities */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-700 mb-1">{t('missed_title')}</p>
          <p className="text-xs text-slate-400 mb-4">{t('missed_subtitle')}</p>
          <MissedTable
            rows={missed}
            platformLabel={t('missed_platform')}
            questionLabel={t('missed_question')}
            competitorsLabel={t('missed_competitors')}
          />
        </div>
      </main>
    </div>
  )
}
