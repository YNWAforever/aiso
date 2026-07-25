import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { ScoreRing } from '@/components/ScoreRing'
import { FixPackClient } from '@/components/FixPackClient'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { CHECK_EXPLANATIONS } from '@/lib/checkExplanations'
import type { Scan, CheckResult } from '@/lib/types'

const CORE_CHECK_KEYS = [
  'c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability',
] as const

const EXTENDED_CHECK_KEYS = [
  'c6_llms_full_txt', 'c7_mcp_card', 'c8_sitemap', 'c9_meta_desc', 'c10_headings',
  'c11_faq', 'c12_canonical', 'c13_render', 'c14_internal_links', 'c15_entity', 'c16_freshness',
] as const

const GEO_CHECK_KEYS = [
  'c17_citation_density', 'c18_factual_density', 'c19_topical_authority', 'c20_chunkability',
] as const

const GRADE_CONFIG: Record<string, { bg: string; text: string; border: string; label: string }> = {
  'A+': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', label: 'Excellent' },
  'A':  { bg: 'bg-green-500/10',   text: 'text-green-400',   border: 'border-green-500/20',  label: 'Very Good' },
  'B':  { bg: 'bg-blue-500/10',    text: 'text-blue-400',    border: 'border-blue-500/20',   label: 'Good' },
  'C':  { bg: 'bg-yellow-500/10',  text: 'text-yellow-400',  border: 'border-yellow-500/20', label: 'Fair' },
  'D':  { bg: 'bg-orange-500/10',  text: 'text-orange-400',  border: 'border-orange-500/20', label: 'Poor' },
  'F':  { bg: 'bg-red-500/10',     text: 'text-red-400',     border: 'border-red-500/20',    label: 'Critical' },
}

export default async function DashboardResultPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string; scanId: string }>
}) {
  const { lang, clientId, scanId } = await params
  const t = await getTranslations()
  const profile = await requireAuth(lang)
  const supabase = await createServerSupabaseClient()

  const { data: scan } = await supabase
    .from('scans')
    .select('*')
    .eq('id', scanId)
    .eq('account_id', profile.account_id)
    .single()

  if (!scan) notFound()

  const s = scan as Scan
  const grade = s.grade ?? 'F'
  const gradeConfig = GRADE_CONFIG[grade] ?? GRADE_CONFIG['F']!
  const scoreLabel = s.score >= 80
    ? t('result.score_good')
    : s.score >= 50
      ? t('result.score_ok')
      : t('result.score_bad')

  // Extract GEO check data from results
  const r = s.results as Record<string, unknown>

  type C17Data = { qualityScore?: number; authorityBreakdown?: Record<string, number>; citationsPerThousandWords?: number }
  type C18Data = { qualityScore?: number; numberDensity?: number; hasComparativeData?: boolean }
  type C19Data = { topicalCoverageScore?: number; totalClusters?: number; hasOrphanPages?: number }
  type C20Data = { avgChunkLength?: number; optimalChunkRatio?: number; totalChunks?: number; hasFaqStyle?: boolean }

  const c17data = (r['c17_citation_density_data'] ?? r['c17']) as C17Data | undefined
  const c18data = (r['c18_factual_density_data']  ?? r['c18']) as C18Data | undefined
  const c19data = (r['c19_topical_authority_data'] ?? r['c19']) as C19Data | undefined
  const c20data = (r['c20_chunkability_data']      ?? r['c20']) as C20Data | undefined
  const hasGeo  = !!(c17data || c18data || c19data || c20data ||
                     r['c17_citation_density'] || r['c18_factual_density'] ||
                     r['c19_topical_authority'] || r['c20_chunkability'])

  // Approximate GEO score from quality scores (weights: c17=7, c18=6, c19=7, c20=5)
  const geoWeights = [7, 6, 7, 5]
  const geoQualityScores = [
    c17data?.qualityScore,
    c18data?.qualityScore,
    c19data?.topicalCoverageScore,
    c20data ? Math.round(((c20data.optimalChunkRatio ?? 0) * 100)) : undefined,
  ]
  const geoScore = geoQualityScores.reduce<number>((acc, q, i) => {
    if (q === undefined) return acc
    const w = geoWeights[i]!
    return acc + (q >= 60 ? w : q >= 30 ? w * 0.5 : 0)
  }, 0)
  const coreScore = Math.max(0, s.score - geoScore)

  // Pass/warn/fail counts
  const allChecks = [
    ...CORE_CHECK_KEYS.map(k => s.results[k]).filter(Boolean),
    ...EXTENDED_CHECK_KEYS.map(k => (s.results as Record<string, unknown>)[k] as CheckResult | undefined).filter(Boolean),
    ...GEO_CHECK_KEYS.map(k => (s.results as Record<string, unknown>)[k] as CheckResult | undefined).filter(Boolean),
  ] as CheckResult[]
  const passes = allChecks.filter(c => c.status === 'pass').length
  const warns  = allChecks.filter(c => c.status === 'warn').length
  const fails  = allChecks.filter(c => c.status === 'fail').length

  const pending = s.agent_status === 'pending' || s.agent_status === 'running'

  return (
    <>
      {/* Top nav bar */}
      <div className="flex flex-col gap-3 border-b border-dash-border bg-dash-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Link
            href={`/${lang}/dashboard/${clientId}?step=results`}
            className="text-xs text-dash-muted hover:text-dash-text transition-colors"
          >
            ← Back to Results
          </Link>
          <span className="text-dash-border">|</span>
          <p className="break-all text-sm font-semibold text-dash-text">{s.domain}</p>
          {pending && (
            <span className="text-[10px] font-medium bg-dash-warning/10 text-dash-warning px-2 py-0.5 rounded-full border border-dash-warning/20">
              Agent analysis pending
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Link
            href={`/${lang}/dashboard/${clientId}/reports/new?scanId=${encodeURIComponent(scanId)}`}
            className="inline-flex min-h-11 items-center px-4 py-2 text-xs font-semibold rounded-lg text-primary-foreground bg-primary hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('reports.create_client_report')}
          </Link>
          <Link
            href={`/${lang}/dashboard/${clientId}?step=improve`}
            className="inline-flex min-h-11 items-center rounded-lg border border-dash-border bg-transparent px-4 py-2 text-xs font-semibold text-dash-text transition-colors hover:bg-dash-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Improve with AI agents →
          </Link>
          <Link
            href={`/${lang}/dashboard/${clientId}?step=scan`}
            className="inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-xs font-medium text-dash-muted transition-colors hover:bg-dash-elevated hover:text-dash-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Full History
          </Link>
        </div>
      </div>

      <main className="flex-1 max-w-2xl mx-auto px-6 py-8 w-full">
        {/* Score + Grade card */}
        <div className="rounded-xl border border-dash-border bg-dash-surface p-6 mb-6 flex items-center gap-5">
          <ScoreRing score={s.score} />
          <div className="flex-1">
            <p className="text-lg font-bold text-dash-text">{s.domain}</p>
            <p className="text-sm text-dash-muted">{t('result.score_label')} — {scoreLabel}</p>
            {s.industry && s.region && (
              <p className="text-xs text-dash-muted/70 mt-0.5">{s.industry} · {s.region}</p>
            )}
          </div>
          <div className={`rounded-xl border-2 ${gradeConfig.bg} ${gradeConfig.border} px-4 py-2 text-center min-w-[64px]`}>
            <p className={`text-2xl font-black ${gradeConfig.text}`}>{grade}</p>
            <p className={`text-xs font-semibold ${gradeConfig.text} mt-0.5`}>{gradeConfig.label}</p>
          </div>
        </div>

        {/* Score breakdown (only if GEO data present) */}
        {hasGeo && (
          <div className="rounded-xl border border-dash-border bg-dash-surface p-5 mb-6">
            <p className="text-xs font-bold text-dash-muted tracking-widest mb-4">{t('result.score_breakdown')}</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-dash-muted">{t('result.core_checks')}</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 rounded-full bg-dash-elevated">
                    <div className="h-full rounded-full bg-dash-accent" style={{ width: `${(coreScore / 75) * 100}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-dash-text w-12 text-right">{Math.round(coreScore)}/75</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-dash-muted">{t('result.geo_checks')}</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 rounded-full bg-dash-elevated">
                    <div className="h-full rounded-full bg-dash-purple" style={{ width: `${(geoScore / 25) * 100}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-dash-text w-12 text-right">{Math.round(geoScore)}/25</span>
                </div>
              </div>
              <div className="border-t border-dash-border pt-2 flex items-center justify-between">
                <span className="text-sm font-bold text-dash-text">{t('result.total_score')}</span>
                <span className="text-sm font-black text-dash-text">{Math.round(s.score)}/100</span>
              </div>
            </div>
          </div>
        )}

        {/* Scan summary pill row */}
        <div className="flex items-center gap-2 mb-4 text-sm flex-wrap">
          <span className="text-dash-muted text-xs">{allChecks.length} checks scanned — click any row for details &amp; fix guidance</span>
          <span className="ml-auto flex gap-2">
            {passes > 0 && <span className="bg-dash-success/10 text-dash-success font-semibold px-2 py-0.5 rounded-full text-xs border border-dash-success/20">✓ {passes} passing</span>}
            {warns  > 0 && <span className="bg-dash-warning/10 text-dash-warning font-semibold px-2 py-0.5 rounded-full text-xs border border-dash-warning/20">⚠ {warns} warnings</span>}
            {fails  > 0 && <span className="bg-dash-danger/10 text-dash-danger font-semibold px-2 py-0.5 rounded-full text-xs border border-dash-danger/20">✗ {fails} failing</span>}
          </span>
        </div>

        {/* Core Checks */}
        <div className="rounded-xl border border-dash-border bg-dash-surface p-6 mb-6">
          <p className="text-xs font-bold text-dash-muted tracking-widest mb-4">{t('result.checks_title')}</p>
          {CORE_CHECK_KEYS.map(key => {
            const checkResult = s.results[key]
            if (!checkResult) return null
            let msg = checkResult.message
            try { msg = t(`checks.${checkResult.message}` as Parameters<typeof t>[0]) } catch { /* raw */ }
            return (
              <ExpandableCheckItem
                key={key}
                label={t(`checks.${key}` as Parameters<typeof t>[0])}
                result={checkResult}
                message={msg}
                explanation={CHECK_EXPLANATIONS[key]}
              />
            )
          })}
        </div>

        {/* Extended Checks */}
        <div className="rounded-xl border border-dash-border bg-dash-surface p-6 mb-6">
          <p className="text-xs font-bold text-dash-muted tracking-widest mb-1">{t('result.extended_checks_title')}</p>
          <p className="text-xs text-dash-muted/70 mb-4">{t('result.extended_checks_subtitle')}</p>
          {EXTENDED_CHECK_KEYS.map(key => {
            const checkResult = (s.results as Record<string, unknown>)[key] as CheckResult | undefined
            if (!checkResult) return null
            let label: string = key, msg = checkResult.message
            try { label = t(`checks.${key}` as Parameters<typeof t>[0]) } catch { /* key */ }
            try { msg   = t(`checks.${checkResult.message}` as Parameters<typeof t>[0]) } catch { /* raw */ }
            return (
              <ExpandableCheckItem
                key={key}
                label={label}
                result={checkResult}
                message={msg}
                explanation={CHECK_EXPLANATIONS[key]}
              />
            )
          })}
        </div>

        {/* GEO Checks */}
        {hasGeo && (
          <div className="rounded-xl border border-dash-border bg-dash-surface p-6 mb-6">
            <p className="text-xs font-bold text-dash-muted tracking-widest mb-1">{t('result.geo_checks_title')}</p>
            <p className="text-xs text-dash-muted/70 mb-4">{t('result.geo_checks_subtitle')}</p>

            {GEO_CHECK_KEYS.map(key => {
              const checkResult = (s.results as Record<string, unknown>)[key] as CheckResult | undefined
              if (!checkResult) return null
              let label: string = key, msg = checkResult.message
              try { label = t(`checks.${key}` as Parameters<typeof t>[0]) } catch { /* key */ }
              try { msg   = t(`checks.${checkResult.message}` as Parameters<typeof t>[0]) } catch { /* raw */ }

              const isC17 = key === 'c17_citation_density'
              const isC18 = key === 'c18_factual_density'
              const isC19 = key === 'c19_topical_authority'
              const isC20 = key === 'c20_chunkability'

              return (
                <div key={key}>
                  <ExpandableCheckItem
                    label={label}
                    result={checkResult}
                    message={msg}
                    explanation={CHECK_EXPLANATIONS[key]}
                  />
                  {/* Inline metric strip shown below each expandable row */}
                  {isC17 && c17data && (
                    <div className="flex gap-3 px-2 pb-2 text-xs text-dash-muted">
                      <span className="text-emerald-400 font-semibold">T1: {c17data.authorityBreakdown?.['tier1'] ?? 0}</span>
                      <span className="text-blue-400 font-semibold">T2: {c17data.authorityBreakdown?.['tier2'] ?? 0}</span>
                      <span>T3: {c17data.authorityBreakdown?.['tier3'] ?? 0}</span>
                      {c17data.citationsPerThousandWords !== undefined && (
                        <span>{c17data.citationsPerThousandWords.toFixed(1)} {t('result.geo_cites_per_k')}</span>
                      )}
                      {c17data.qualityScore !== undefined && (
                        <span className="ml-auto font-semibold">{t('result.geo_quality_score')}: {Math.round(c17data.qualityScore)}/100</span>
                      )}
                    </div>
                  )}
                  {isC18 && c18data && (
                    <div className="flex gap-3 px-2 pb-2 text-xs text-dash-muted">
                      {c18data.numberDensity !== undefined && <span>{t('result.geo_number_density')}: {c18data.numberDensity.toFixed(1)}%</span>}
                      {c18data.hasComparativeData && <span className="text-emerald-400">✓ {t('result.geo_has_comparisons')}</span>}
                      {c18data.qualityScore !== undefined && (
                        <span className="ml-auto font-semibold">{t('result.geo_quality_score')}: {Math.round(c18data.qualityScore)}/100</span>
                      )}
                    </div>
                  )}
                  {isC19 && c19data && (
                    <div className="flex gap-3 px-2 pb-2 text-xs text-dash-muted">
                      <span>{c19data.totalClusters ?? 0} {t('result.geo_clusters')}</span>
                      {(c19data.hasOrphanPages ?? 0) > 0 && (
                        <span className="text-amber-400">{c19data.hasOrphanPages} {t('result.geo_orphan_pages')}</span>
                      )}
                      {c19data.topicalCoverageScore !== undefined && (
                        <span className="ml-auto font-semibold">{t('result.geo_quality_score')}: {Math.round(c19data.topicalCoverageScore)}/100</span>
                      )}
                    </div>
                  )}
                  {isC20 && c20data && (
                    <div className="flex gap-4 px-2 pb-2 text-xs text-dash-muted">
                      <span>{c20data.totalChunks ?? 0} {t('result.geo_chunks')}</span>
                      <span>{Math.round((c20data.optimalChunkRatio ?? 0) * 100)}% {t('result.geo_optimal')}</span>
                      {c20data.hasFaqStyle && <span className="text-emerald-400">✓ {t('result.geo_faq_style')}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Fix Pack */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-xs font-bold text-dash-muted tracking-widest">PHASE 2 — FIX PACK</p>
            <span className="text-xs text-dash-muted/70">AI-generated files ready to deploy</span>
          </div>
          <div className="rounded-xl border border-dash-border bg-dash-elevated p-4 mb-3 text-sm text-dash-muted space-y-1">
            <p className="font-semibold text-dash-text mb-2">What gets generated:</p>
            <p>📄 <strong>llms.txt</strong> — tells AI platforms what your site covers (fixes c2, c6)</p>
            <p>🤖 <strong>robots.txt patch</strong> — explicitly allows AI crawlers (fixes c1, c3)</p>
            <p>🗂 <strong>FAQ JSON-LD</strong> — structured Q&amp;As for AI citation (fixes c4, c11)</p>
          </div>
          <FixPackClient
            scanId={s.id}
            fixCta={t('result.fix_cta')}
            fixSubtitle={t('result.fix_subtitle')}
            copyLabel={t('result.copy')}
            copiedLabel={t('result.copied')}
          />
        </div>

        {/* Bottom nav */}
        <div className="flex items-center justify-between">
          <Link
            href={`/${lang}/dashboard/${clientId}?step=results`}
            className="text-xs text-dash-muted hover:text-dash-text transition-colors"
          >
            ← Back to Results
          </Link>
          <Link
            href={`/${lang}/dashboard/${clientId}?step=improve`}
            className="inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-lg text-primary-foreground bg-dash-accent hover:opacity-90 transition-opacity"
          >
            Improve with AI agents →
          </Link>
        </div>
      </main>
    </>
  )
}
