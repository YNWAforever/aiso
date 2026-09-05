'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { Zap } from 'lucide-react'
import { useLocale } from 'next-intl'
import { ScoreReveal }      from './ScoreReveal'
import { TopIssueCard }     from './TopIssueCard'
import { LockedPreview }    from './LockedPreview'
import { DeepGeoSection }   from './DeepGeoSection'
import { ImpactTeaser }     from './ImpactTeaser'
import { ImpactPanel }      from './ImpactPanel'
import { ShareButton }      from './ShareButton'
import { AccountUnlockCard } from './AccountUnlockCard'
import { ClaimScanOnReturn } from './ClaimScanOnReturn'
import { PillarScoreCards } from '@/components/PillarScoreCards'
import { ScanEvidencePanel } from './ScanEvidencePanel'
import type { OwnedResultEvidence } from '@/lib/result-evidence'
import { computeImpact, type PlatformStatus } from '@/lib/impact'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { getCheckExplanations }  from '@/lib/checkExplanations'
import type { Scan, CheckResult, ScanResults } from '@/lib/types'
import type { PublicResultSummary } from '@/lib/result-access'
import { consumeOneTimeFunnelEvent, trackFunnelEvent } from '@/lib/funnel-client'

/* ── Check key lists ─────────────────────────────────────────── */
const CORE_KEYS = ['c1_robots','c2_llms_txt','c3_bot_access','c4_structured_data','c5_extractability'] as const
const EXT_KEYS  = ['c6_llms_full_txt','c7_mcp_card','c8_sitemap','c9_meta_desc','c10_headings','c11_faq','c12_canonical','c13_render','c14_internal_links','c15_entity','c16_freshness'] as const
const GEO_KEYS  = ['c17_citation_density','c18_factual_density','c19_topical_authority','c20_chunkability'] as const

const CHECK_LABELS_EN: Record<string, string> = {
  c1_robots:            'robots.txt for AI crawlers',
  c2_llms_txt:          'llms.txt present',
  c3_bot_access:        'AI bot accessibility',
  c4_structured_data:   'Structured data (JSON-LD)',
  c5_extractability:    'Content extractability',
  c6_llms_full_txt:     'llms-full.txt',
  c7_mcp_card:          'MCP server card',
  c8_sitemap:           'XML sitemap',
  c9_meta_desc:         'Meta descriptions',
  c10_headings:         'Heading structure',
  c11_faq:              'FAQ schema',
  c12_canonical:        'Canonical tags',
  c13_render:           'Server-side rendering',
  c14_internal_links:   'Internal link graph',
  c15_entity:           'Entity signals',
  c16_freshness:        'Content freshness',
  c17_citation_density: 'Citation density & authority',
  c18_factual_density:  'Factual density',
  c19_topical_authority:'Topical authority',
  c20_chunkability:     'AI chunkability',
}

const CHECK_LABELS_ZH_HK: Record<string, string> = {
  c1_robots:            'robots.txt AI 爬蟲規則',
  c2_llms_txt:          'llms.txt 是否存在',
  c3_bot_access:        'AI 機械人可存取性',
  c4_structured_data:   '結構化數據（JSON-LD）',
  c5_extractability:    '內容可提取度',
  c6_llms_full_txt:     'llms-full.txt',
  c7_mcp_card:          'MCP 伺服器卡片',
  c8_sitemap:           'XML sitemap',
  c9_meta_desc:         'Meta description',
  c10_headings:         '標題結構',
  c11_faq:              'FAQ schema',
  c12_canonical:        'canonical 標籤',
  c13_render:           '伺服器端渲染',
  c14_internal_links:   '內部連結網絡',
  c15_entity:           '實體訊號',
  c16_freshness:        '內容新鮮度',
  c17_citation_density: '引用密度及權威度',
  c18_factual_density:  '事實密度',
  c19_topical_authority:'主題權威',
  c20_chunkability:     'AI 分塊能力',
}

const UI_EN = {
  getFullAccess: 'Get full access',
  checksScanned: (n: number) => `${n} checks scanned`,
  passing:  (n: number) => `${n} passing`,
  warnings: (n: number) => `${n} warnings`,
  failing:  (n: number) => `${n} failing`,
  coreTitle: 'CORE CHECKS',
  extTitle:  'EXTENDED CHECKS',
  extSubtitle: 'Additional signals that strengthen your AI visibility',
  geoTitle:  'GEO CHECKS',
  geoSubtitle: 'Generative Engine Optimisation — content quality for AI citation',
  scanAnother: '← Scan another URL',
  platforms: 'Estimated AI platform readiness',
  platformNote: 'Inferred from site checks, not observed AI answers or measured visibility.',
  estimatedImpact: 'Estimated impact: the following projections are inferred from site checks, not measured visibility or guaranteed gains.',
  openFixPack: 'Open your Fix Pack',
}

const UI_ZH_HK: typeof UI_EN = {
  getFullAccess: '解鎖完整版',
  checksScanned: (n: number) => `已掃描 ${n} 項檢查`,
  passing:  (n: number) => `${n} 項通過`,
  warnings: (n: number) => `${n} 項警告`,
  failing:  (n: number) => `${n} 項不及格`,
  coreTitle: '核心檢查',
  extTitle:  '進階檢查',
  extSubtitle: '進一步強化 AI 可見度的附加訊號',
  geoTitle:  'GEO 檢查',
  geoSubtitle: '生成式引擎優化——內容能否被 AI 引用的質素指標',
  scanAnother: '← 掃描另一個網址',
  platforms: 'AI 平台就緒度估算',
  platformNote: '根據網站檢查推斷，並非實際 AI 回答觀測或可見度測量。',
  estimatedImpact: '預估影響：以下推算根據網站檢查，並非實際可見度測量，亦不保證改善成效。',
  openFixPack: '開啟你的 Fix Pack',
}

/* ── Helpers ────────────────────────────────────────────────── */
function getResult(results: Record<string, unknown>, key: string): CheckResult | undefined {
  const v = results[key]
  if (v && typeof v === 'object' && 'status' in (v as object)) return v as CheckResult
  return undefined
}

const PLATFORM_STATUS_LABELS: Record<'en' | 'zh-HK', Record<PlatformStatus, string>> = {
  en: { visible: 'Visible', partial: 'Partial', blocked: 'Hidden' },
  'zh-HK': { visible: '可見', partial: '部分可見', blocked: '隱藏' },
}

export function getPlatformStatusLabel(status: PlatformStatus, locale: string) {
  return PLATFORM_STATUS_LABELS[locale === 'zh-HK' ? 'zh-HK' : 'en'][status]
}

/* ── Section: check list ─────────────────────────────────────── */
function CheckSection({ title, subtitle, keys, results }: {
  title: string; subtitle?: string; keys: readonly string[]; results: Record<string, unknown>
}) {
  const locale = useLocale()
  const labels = locale === 'zh-HK' ? CHECK_LABELS_ZH_HK : CHECK_LABELS_EN
  const explanations = getCheckExplanations(locale)
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <p className="text-xs font-bold text-slate-500 tracking-widest mb-1">{title}</p>
      {subtitle && <p className="text-xs text-slate-500 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {keys.map(key => {
        const r = getResult(results, key)
        if (!r) return null
        return (
          <div key={key} id={key} className="scroll-mt-20">
            <ExpandableCheckItem
              label={labels[key] ?? key}
              result={r}
              message={r.message}
              explanation={explanations[key]}
            />
          </div>
        )
      })}
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────── */
type Props = {
  lang: string
  summary: PublicResultSummary
  fullScan?: Scan
  ownedEvidence?: OwnedResultEvidence | null
}

export function ResultClient({ lang, summary, fullScan, ownedEvidence }: Props) {
  const locale = useLocale()
  const resultViewTracked = useRef(false)
  const signupCtaTracked = useRef(false)
  const ui = locale === 'zh-HK' ? UI_ZH_HK : UI_EN
  const { pass, warn, fail, total } = summary.counts
  const r = (fullScan?.results ?? {}) as Record<string, unknown>
  const impact = fullScan
    ? computeImpact(r, { score: fullScan.score, grade: fullScan.grade ?? 'F', industry: fullScan.industry })
    : null
  const publicImpact = { ...summary.teaser, aiReadablePercent: null, quickWins: [] }
  const topIssueResults = summary.topIssueKey && summary.topIssueStatus
    ? { [summary.topIssueKey]: { status: summary.topIssueStatus, message: 'public_summary' } }
    : {}

  useEffect(() => {
    if (!consumeOneTimeFunnelEvent(resultViewTracked)) return
    const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
    trackFunnelEvent({ name: 'scan_result_viewed', locale, scanId: summary.id })
  }, [lang, summary.id])

  useEffect(() => {
    if (fullScan || !consumeOneTimeFunnelEvent(signupCtaTracked)) return
    const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
    trackFunnelEvent({ name: 'signup_cta_viewed', locale, scanId: summary.id })
  }, [fullScan, lang, summary.id])

  // GEO rich data
  type C17 = { qualityScore?: number; authorityBreakdown?: Record<string, number>; citationsPerThousandWords?: number; totalLinks?: number; externalLinks?: number }
  type C18 = { qualityScore?: number; numberDensity?: number; namedEntityDensity?: number; dateReferences?: number; hasComparativeData?: boolean; hasTimeSeriesData?: boolean; uniquenessScore?: number }
  type C19 = { topicalCoverageScore?: number; totalClusters?: number; hasOrphanPages?: number; detectedClusters?: { topic: string; completenessScore: number }[] }
  type C20 = { avgChunkLength?: number; optimalChunkRatio?: number; totalChunks?: number; hasFaqStyle?: boolean; chunkAnalysis?: { heading: string; extractabilityScore: number; isAnswerFirst?: boolean; isSelfContained?: boolean }[] }

  const c17 = (r['c17_citation_density_data'] ?? r['c17']) as C17 | undefined
  const c18 = (r['c18_factual_density_data']  ?? r['c18']) as C18 | undefined
  const c19 = (r['c19_topical_authority_data'] ?? r['c19']) as C19 | undefined
  const c20 = (r['c20_chunkability_data']      ?? r['c20']) as C20 | undefined

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Nav */}
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center sticky top-0 z-50">
        <Link href={`/${lang}`} className="flex items-center gap-2">
          <div className="size-6 rounded-md bg-primary flex items-center justify-center">
            <Zap className="size-3.5 text-primary-foreground" />
          </div>
          <span className="font-black text-slate-900 text-sm">
            Fimmick <span className="text-primary">AISO</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <ShareButton domain={summary.domain} score={summary.score} grade={summary.grade} />
          {fullScan ? (
            <Link
              href={`/${lang}/pricing`}
              className="text-sm font-semibold bg-primary text-primary-foreground px-4 py-1.5 rounded-lg hover:bg-primary/90 transition"
            >
              {ui.getFullAccess}
            </Link>
          ) : null}
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-10 space-y-5">
        <ClaimScanOnReturn scanId={summary.id} lang={lang} />

        {/* 1. Score reveal */}
        <div data-testid="result-score">
          <ScoreReveal
            score={summary.score}
            grade={summary.grade}
            domain={summary.domain}
            industry={summary.industry}
            region={summary.region}
          />
        </div>

        {/* 2. Summary pills */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-slate-500">{ui.checksScanned(total)}</span>
          <span className="ml-auto flex gap-2">
            {pass > 0 && <span className="bg-emerald-100 text-emerald-700 font-semibold px-2.5 py-1 rounded-full">✅ {ui.passing(pass)}</span>}
            {warn > 0 && <span className="bg-amber-100  text-amber-700  font-semibold px-2.5 py-1 rounded-full">⚠️ {ui.warnings(warn)}</span>}
            {fail > 0 && <span className="bg-red-100    text-red-700    font-semibold px-2.5 py-1 rounded-full">❌ {ui.failing(fail)}</span>}
          </span>
        </div>

        {/* 3. #1 Issue card */}
        <div data-testid="result-top-issue">
          <TopIssueCard
            results={topIssueResults as ScanResults & Record<string, unknown>}
            failCount={fail + warn}
          />
        </div>

        {/* 4. Public teaser or owner-only full results */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-bold text-slate-500 tracking-widest mb-3">{ui.platforms}</p>
          <p className="mb-3 text-xs text-slate-500">{ui.platformNote}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {summary.teaser.platformVisibility.map(platform => (
              <div key={platform.platform} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-slate-700">{platform.label}</span>
                <span
                  data-status={platform.status}
                  aria-label={`${platform.label}: ${getPlatformStatusLabel(platform.status, locale)}`}
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    platform.status === 'visible'
                      ? 'bg-emerald-100 text-emerald-700'
                      : platform.status === 'partial'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                  }`}
                >
                  {getPlatformStatusLabel(platform.status, locale)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {fullScan && impact ? (
          <>
            <PillarScoreCards results={r} locale={locale} evidenceInputs={ownedEvidence?.pillarInputs} />
            <ScanEvidencePanel evidence={ownedEvidence ?? null} locale={locale} />
            <section aria-label={ui.estimatedImpact}>
              <p className="mb-2 text-sm font-semibold text-slate-700">{ui.estimatedImpact}</p>
              <ImpactPanel impact={impact} score={fullScan.score} grade={fullScan.grade ?? 'F'} />
            </section>

            <div data-testid="full-check-breakdown" className="space-y-5">
              <CheckSection title={ui.coreTitle} keys={CORE_KEYS} results={r} />
              <CheckSection
                title={ui.extTitle}
                subtitle={ui.extSubtitle}
                keys={EXT_KEYS}
                results={r}
              />
              <CheckSection
                title={ui.geoTitle}
                subtitle={ui.geoSubtitle}
                keys={GEO_KEYS}
                results={r}
              />
              <DeepGeoSection c17={c17} c18={c18} c19={c19} c20={c20} />
            </div>

            <Link
              href={`/${lang}/dashboard`}
              data-testid="fix-pack-action"
              className="block rounded-2xl bg-slate-900 px-6 py-4 text-center text-sm font-bold text-white hover:bg-slate-800 transition"
            >
              {ui.openFixPack}
            </Link>
          </>
        ) : (
          <>
            <section aria-label={ui.estimatedImpact}>
              <p className="mb-2 text-sm font-semibold text-slate-700">{ui.estimatedImpact}</p>
              <ImpactTeaser impact={publicImpact} score={summary.score} />
            </section>
            <LockedPreview checkCount={total} />
            <AccountUnlockCard scanId={summary.id} lang={lang} />
          </>
        )}

        {/* Scan another */}
        <div className="text-center pb-4">
          <Link href={`/${lang}`} className="text-sm text-slate-500 hover:text-slate-700 transition underline underline-offset-2">
            {ui.scanAnother}
          </Link>
        </div>
      </main>
    </div>
  )
}
