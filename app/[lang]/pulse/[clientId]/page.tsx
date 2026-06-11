// app/[lang]/pulse/[clientId]/page.tsx
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { SovChart }              from '@/components/pulse/SovChart'
import { PlatformBar }           from '@/components/pulse/PlatformBar'
import { MissedTable }           from '@/components/pulse/MissedTable'
import { ScanLogSection }        from '@/components/pulse/ScanLogSection'
import { QuestionBankSection }   from '@/components/pulse/QuestionBankSection'
import { requireAuth }           from '@/lib/auth'
import { planAllows }            from '@/lib/tier'
import type { PulseWeeklySummary, PulseMetric, PromptBankItem } from '@/lib/types'

export default async function PulsePage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  const t = await getTranslations('pulse')

  const profile  = await requireAuth(lang)
  const plan     = profile.accounts?.plan ?? 'basic'
  const canEditPrompts = planAllows(plan, 'edit_prompts')

  const supabase = await createServerSupabaseClient()

  const { data: clientData } = await supabase
    .from('clients').select('brand_name, industry')
    .eq('id', clientId).eq('account_id', profile.account_id).single()
  if (!clientData) notFound()

  const [
    { data: summaryRaw },
    { data: missedRaw },
    { data: allMetricsRaw },
    { data: promptsRaw },
  ] = await Promise.all([
    supabase.from('pulse_weekly_summary').select('*').eq('client_id', clientId).order('scan_week').limit(40),
    supabase.from('pulse_metrics').select('platform,question,competitors_mentioned,scan_week')
      .eq('client_id', clientId).eq('brand_mentioned', false)
      .order('scan_week', { ascending: false }).limit(50),
    // All metrics for latest week (Section ②)
    supabase.from('pulse_metrics')
      .select('platform,question,prompt_id,raw_answer,brand_mentioned,sentiment,mention_position,competitors_mentioned,scan_week,client_id,id,created_at')
      .eq('client_id', clientId)
      .order('scan_week', { ascending: false })
      .limit(500),
    supabase.from('prompt_bank').select('*').eq('client_id', clientId).order('category').order('created_at'),
  ])

  const summary   = (summaryRaw   ?? []) as PulseWeeklySummary[]
  const missed    = (missedRaw    ?? []) as PulseMetric[]
  const prompts   = (promptsRaw   ?? []) as PromptBankItem[]

  // Use only the most recent scan week for the scan log
  const allMetrics   = (allMetricsRaw ?? []) as PulseMetric[]
  const latestWeek   = allMetrics[0]?.scan_week ?? ''
  const weekMetrics  = allMetrics.filter(m => m.scan_week === latestWeek)

  const kpi = summary.find(d => d.scan_week === summary.at(-1)?.scan_week && !d.platform)

  const sentimentLabel = (s: number | undefined) => {
    if (s === undefined || s === null) return '—'
    if (s > 0.3)  return t('sentiment_positive')
    if (s < -0.3) return t('sentiment_negative')
    return t('sentiment_neutral')
  }

  const isFirstTimePrompts = prompts.length > 0 &&
    Math.abs(new Date(prompts.at(-1)!.created_at).getTime() - Date.now()) < 5 * 60 * 1000

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center sticky top-0 z-30">
        <span className="font-bold text-slate-900">
          Fimmick <span className="text-blue-600">{t('title')}</span>
          <span className="ml-2 text-sm font-normal text-slate-500">{clientData.brand_name}</span>
        </span>
        <div className="flex items-center gap-4">
          <a href="#overview"      className="text-xs text-slate-500 hover:text-slate-900 transition hidden sm:block">{t('nav_overview')}</a>
          <a href="#scan-log"      className="text-xs text-slate-500 hover:text-slate-900 transition hidden sm:block">{t('nav_scan_log')}</a>
          <a href="#question-bank" className="text-xs text-slate-500 hover:text-slate-900 transition hidden sm:block">{t('nav_questions')}</a>
          <span className="text-xs text-slate-400">{kpi?.scan_week ? t('week_of', { week: kpi.scan_week }) : t('no_data')}</span>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-10">

        {/* ── Section ①: Overview ─────────────────────────── */}
        <div id="overview" className="space-y-6">
          <div>
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-4">{t('nav_overview')}</h2>
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
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-4">{t('sov_trend')}</p>
            <SovChart data={summary} />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-4">{t('platform_breakdown')}</p>
            <PlatformBar data={summary} />
          </div>

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
        </div>

        {/* ── Section ②: Scan Log ─────────────────────────── */}
        <ScanLogSection
          metrics={weekMetrics}
          scanWeek={latestWeek}
          brandName={clientData.brand_name}
        />

        {/* ── Section ③: Question Bank ─────────────────────── */}
        {canEditPrompts ? (
          <QuestionBankSection
            clientId={clientId}
            initialPrompts={prompts}
            isFirstTime={isFirstTimePrompts}
          />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
            <p className="text-sm font-semibold text-slate-500">{t('qb_title')}</p>
            <p className="text-xs text-slate-400 mt-1">
              {t('qb_locked_body')}{' '}
              <Link href={`/${lang}/pricing`} className="text-primary underline">{t('qb_see_plans')}</Link>
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
