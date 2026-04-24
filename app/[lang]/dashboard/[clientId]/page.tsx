import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { SovChart }      from '@/components/pulse/SovChart'
import { PlatformBar }   from '@/components/pulse/PlatformBar'
import { MissedTable }   from '@/components/pulse/MissedTable'
import { CompetitorTab } from '@/components/pulse/CompetitorTab'
import { AlertsTab }     from '@/components/pulse/AlertsTab'
import { TopBar }        from '@/components/dashboard/TopBar'
import { PulseTabs }     from '@/components/dashboard/PulseTabs'
import type { PulseWeeklySummary, PulseMetric } from '@/lib/types'

export default async function DashboardPulsePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { lang, clientId } = await params
  const { tab = 'overview' } = await searchParams
  const profile  = await requireAuth(lang)
  const supabase = await createServerSupabaseClient()

  const { data: client } = await supabase
    .from('clients').select('brand_name')
    .eq('id', clientId).eq('account_id', profile.account_id).single()

  if (!client) notFound()

  const [{ data: summaryRaw }, { data: missedRaw }] = await Promise.all([
    supabase.from('pulse_weekly_summary').select('*')
      .eq('client_id', clientId).order('scan_week').limit(40),
    supabase.from('pulse_metrics')
      .select('platform,question,competitors_mentioned,scan_week')
      .eq('client_id', clientId).eq('brand_mentioned', false)
      .order('scan_week', { ascending: false }).limit(50),
  ])

  const summary = (summaryRaw ?? []) as PulseWeeklySummary[]
  const missed  = (missedRaw  ?? []) as PulseMetric[]
  const latestWeek = summary.at(-1)?.scan_week
  const kpi = summary.find(d => d.scan_week === latestWeek && !d.platform)

  return (
    <>
      <TopBar
        title={client.brand_name}
        subtitle={kpi?.scan_week ? `Week of ${kpi.scan_week}` : 'No data yet'}
      />
      <Suspense fallback={null}>
        <PulseTabs />
      </Suspense>

      <main className="flex-1 px-6 py-8 max-w-3xl space-y-6">

        {tab === 'overview' && (
          <>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Share of Voice', value: kpi ? `${kpi.sov_score}%` : '—' },
                { label: 'Mentions',       value: kpi ? `${kpi.brand_mentions}/${kpi.total_queries}` : '—' },
                { label: 'Platforms',      value: '4' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white rounded-xl border border-slate-200 p-5 text-center">
                  <p className="text-2xl font-black text-blue-600">{value}</p>
                  <p className="text-xs text-slate-500 mt-1">{label}</p>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <p className="text-sm font-semibold text-slate-700 mb-4">SoV Trend</p>
              <SovChart data={summary} />
            </div>
          </>
        )}

        {tab === 'platforms' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-4">Platform Breakdown</p>
            <PlatformBar data={summary} />
          </div>
        )}

        {tab === 'missed' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-1">Missed Opportunities</p>
            <p className="text-xs text-slate-400 mb-4">Queries where your brand was not mentioned</p>
            <MissedTable rows={missed} platformLabel="Platform" questionLabel="Question" competitorsLabel="Competitors" />
          </div>
        )}

        {tab === 'competitors' && (
          <CompetitorTab summary={summary} brandName={client.brand_name} />
        )}

        {tab === 'alerts' && (
          <AlertsTab clientId={clientId} />
        )}

      </main>
    </>
  )
}
