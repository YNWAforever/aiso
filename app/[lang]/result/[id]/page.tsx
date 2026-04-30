import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { supabase }                from '@/lib/supabase'
import { getProfile }              from '@/lib/auth'
import { ScoreRing }               from '@/components/ScoreRing'
import { FixPackClient }           from '@/components/FixPackClient'
import { SaveScanButton }          from '@/components/SaveScanButton'
import { ExpandableCheckItem }     from '@/components/ExpandableCheckItem'
import { CHECK_EXPLANATIONS }      from '@/lib/checkExplanations'
import type { Scan, CheckResult }  from '@/lib/types'

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
  'A+': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Excellent' },
  'A':  { bg: 'bg-green-50',   text: 'text-green-700',   border: 'border-green-200',   label: 'Very Good' },
  'B':  { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    label: 'Good' },
  'C':  { bg: 'bg-yellow-50',  text: 'text-yellow-700',  border: 'border-yellow-200',  label: 'Fair' },
  'D':  { bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200',  label: 'Poor' },
  'F':  { bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     label: 'Critical' },
}

function GeoMetricBar({ label, score, max = 100 }: { label: string; score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100)
  const color = pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="py-2 border-b border-slate-100 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-700">{label}</span>
        <span className="text-sm font-semibold text-slate-900">{Math.round(score)}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default async function ResultPage({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang, id } = await params
  const t = await getTranslations()

  const [{ data: scan }, profile] = await Promise.all([
    supabase.from('scans').select('*').eq('id', id).single(),
    getProfile().catch(() => null),
  ])
  if (!scan) notFound()

  const s = scan as Scan
  const grade = s.grade ?? 'F'
  const gradeConfig = GRADE_CONFIG[grade] ?? GRADE_CONFIG['F']!
  const scoreLabel = s.score >= 80 ? t('result.score_good') : s.score >= 50 ? t('result.score_ok') : t('result.score_bad')
  const canSave = profile && !s.account_id

  // Extract GEO check data from results
  // New format (named keys + _data suffix); fall back to old numeric keys for existing scans
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

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <Link href={`/${lang}`} className="font-bold text-slate-900">
          Fimmick <span className="text-blue-600">AISO</span>
        </Link>
        <div className="flex items-center gap-4">
          {canSave ? (
            <SaveScanButton scanId={s.id} lang={lang} />
          ) : profile ? (
            <Link href={`/${lang}/dashboard`} className="text-sm text-slate-500 hover:text-slate-900 transition">
              Dashboard
            </Link>
          ) : (
            <Link href={`/${lang}/auth/login`} className="text-sm text-slate-500 hover:text-slate-900 transition">
              {t('nav.sign_in')}
            </Link>
          )}
          <Link
            href={`/${lang}/pricing`}
            className="text-sm font-semibold bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 transition"
          >
            {t('nav.get_started')}
          </Link>
          <Link href={`/${lang === 'en' ? 'zh-HK' : 'en'}/result/${id}`} className="text-sm text-blue-600 hover:underline">
            {lang === 'en' ? '中文' : 'EN'}
          </Link>
        </div>
      </nav>

      <main className="max-w-xl mx-auto px-6 py-10">

        {/* Score + Grade card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 flex items-center gap-5">
          <ScoreRing score={s.score} />
          <div className="flex-1">
            <p className="text-lg font-bold text-slate-900">{s.domain}</p>
            <p className="text-sm text-slate-500">{t('result.score_label')} — {scoreLabel}</p>
            {s.industry && s.region && (
              <p className="text-xs text-slate-400 mt-0.5">{s.industry} · {s.region}</p>
            )}
          </div>
          {/* Grade badge */}
          <div className={`rounded-xl border-2 ${gradeConfig.bg} ${gradeConfig.border} px-4 py-2 text-center min-w-[64px]`}>
            <p className={`text-2xl font-black ${gradeConfig.text}`}>{grade}</p>
            <p className={`text-xs font-semibold ${gradeConfig.text} mt-0.5`}>{gradeConfig.label}</p>
          </div>
        </div>

        {/* Score breakdown (only if GEO data present) */}
        {hasGeo && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
            <p className="text-xs font-bold text-slate-500 tracking-widest mb-4">{t('result.score_breakdown')}</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{t('result.core_checks')}</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${(coreScore / 75) * 100}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-slate-900 w-12 text-right">{Math.round(coreScore)}/75</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{t('result.geo_checks')}</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-violet-500" style={{ width: `${(geoScore / 25) * 100}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-slate-900 w-12 text-right">{Math.round(geoScore)}/25</span>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">{t('result.total_score')}</span>
                <span className="text-sm font-black text-slate-900">{Math.round(s.score)}/100</span>
              </div>
            </div>
          </div>
        )}

        {/* Scan summary pill row */}
        {(() => {
          const allChecks = [
            ...CORE_CHECK_KEYS.map(k => s.results[k]).filter(Boolean),
            ...EXTENDED_CHECK_KEYS.map(k => (s.results as Record<string, unknown>)[k] as CheckResult | undefined).filter(Boolean),
            ...GEO_CHECK_KEYS.map(k => (s.results as Record<string, unknown>)[k] as CheckResult | undefined).filter(Boolean),
          ] as CheckResult[]
          const passes = allChecks.filter(c => c.status === 'pass').length
          const warns  = allChecks.filter(c => c.status === 'warn').length
          const fails  = allChecks.filter(c => c.status === 'fail').length
          return (
            <div className="flex items-center gap-2 mb-4 text-sm flex-wrap">
              <span className="text-slate-500 text-xs">{allChecks.length} checks scanned — click any row for details &amp; fix guidance</span>
              <span className="ml-auto flex gap-2">
                {passes > 0 && <span className="bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full text-xs">✅ {passes} passing</span>}
                {warns  > 0 && <span className="bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full text-xs">⚠️ {warns} warnings</span>}
                {fails  > 0 && <span className="bg-red-100   text-red-700   font-semibold px-2 py-0.5 rounded-full text-xs">❌ {fails} failing</span>}
              </span>
            </div>
          )
        })()}

        {/* Core Checks */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <p className="text-xs font-bold text-slate-500 tracking-widest mb-4">{t('result.checks_title')}</p>
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
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <p className="text-xs font-bold text-slate-500 tracking-widest mb-1">{t('result.extended_checks_title')}</p>
          <p className="text-xs text-slate-400 mb-4">{t('result.extended_checks_subtitle')}</p>
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
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <p className="text-xs font-bold text-slate-500 tracking-widest mb-1">{t('result.geo_checks_title')}</p>
            <p className="text-xs text-slate-400 mb-4">{t('result.geo_checks_subtitle')}</p>

            {GEO_CHECK_KEYS.map(key => {
              const checkResult = (s.results as Record<string, unknown>)[key] as CheckResult | undefined
              if (!checkResult) return null
              let label: string = key, msg = checkResult.message
              try { label = t(`checks.${key}` as Parameters<typeof t>[0]) } catch { /* key */ }
              try { msg   = t(`checks.${checkResult.message}` as Parameters<typeof t>[0]) } catch { /* raw */ }

              // Pick the matching rich detail data for inline metrics
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
                    <div className="flex gap-3 px-2 pb-2 text-xs text-slate-500">
                      <span className="text-emerald-600 font-semibold">T1: {c17data.authorityBreakdown?.['tier1'] ?? 0}</span>
                      <span className="text-blue-600 font-semibold">T2: {c17data.authorityBreakdown?.['tier2'] ?? 0}</span>
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
                    <div className="flex gap-3 px-2 pb-2 text-xs text-slate-500">
                      {c18data.numberDensity !== undefined && <span>{t('result.geo_number_density')}: {c18data.numberDensity.toFixed(1)}%</span>}
                      {c18data.hasComparativeData && <span className="text-emerald-600">✓ {t('result.geo_has_comparisons')}</span>}
                      {c18data.qualityScore !== undefined && (
                        <span className="ml-auto font-semibold">{t('result.geo_quality_score')}: {Math.round(c18data.qualityScore)}/100</span>
                      )}
                    </div>
                  )}
                  {isC19 && c19data && (
                    <div className="flex gap-3 px-2 pb-2 text-xs text-slate-500">
                      <span>{c19data.totalClusters ?? 0} {t('result.geo_clusters')}</span>
                      {(c19data.hasOrphanPages ?? 0) > 0 && (
                        <span className="text-amber-600">{c19data.hasOrphanPages} {t('result.geo_orphan_pages')}</span>
                      )}
                      {c19data.topicalCoverageScore !== undefined && (
                        <span className="ml-auto font-semibold">{t('result.geo_quality_score')}: {Math.round(c19data.topicalCoverageScore)}/100</span>
                      )}
                    </div>
                  )}
                  {isC20 && c20data && (
                    <div className="flex gap-4 px-2 pb-2 text-xs text-slate-500">
                      <span>{c20data.totalChunks ?? 0} {t('result.geo_chunks')}</span>
                      <span>{Math.round((c20data.optimalChunkRatio ?? 0) * 100)}% {t('result.geo_optimal')}</span>
                      {c20data.hasFaqStyle && <span className="text-emerald-600">✓ {t('result.geo_faq_style')}</span>}
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
            <p className="text-xs font-bold text-slate-500 tracking-widest">PHASE 2 — FIX PACK</p>
            <span className="text-xs text-slate-400">AI-generated files ready to deploy</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-3 text-sm text-slate-600 space-y-1">
            <p className="font-semibold text-slate-700 mb-2">What gets generated:</p>
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

        {/* Post-scan upsell */}
        <div className="bg-slate-900 rounded-xl p-7 mt-6 text-center">
          <p className="text-2xl">📊</p>
          <h2 className="text-white font-black text-lg mt-2">
            {t('upsell.title', { domain: s.domain })}
          </h2>
          <p className="text-slate-400 text-sm mt-2 max-w-xs mx-auto">
            {t('upsell.body')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
            <Link
              href={`/${lang}/auth/login`}
              className="bg-blue-600 text-white font-semibold px-6 py-2.5 rounded-lg text-sm hover:bg-blue-700 transition"
            >
              {t('upsell.cta_primary')}
            </Link>
            <Link
              href={`/${lang}/pricing`}
              className="bg-slate-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm hover:bg-slate-600 transition"
            >
              {t('upsell.cta_secondary')}
            </Link>
          </div>
          <p className="mt-4">
            <Link href={`/${lang}/auth/login`} className="text-slate-500 text-xs hover:text-slate-300 transition">
              {t('upsell.sign_in')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
