'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Zap } from 'lucide-react'
import { useLocale, useMessages, useTranslations } from 'next-intl'
import { ScoreReveal }      from './ScoreReveal'
import { TopIssueCard }     from './TopIssueCard'
import { DeepGeoSection }   from './DeepGeoSection'
import { TrustSignalsSection } from './TrustSignalsSection'
import { AccountUnlockCard } from './AccountUnlockCard'
import { ClaimScanOnReturn } from './ClaimScanOnReturn'
import { ScanEvidencePanel } from './ScanEvidencePanel'
import { ResultActions } from './ResultActions'
import { FixList } from './FixList'
import { FixDrawer } from './FixDrawer'
import { CheckList } from './CheckList'
import { PotentialScoreBar } from '@/components/visuals/PotentialScoreBar'
import { PillarGauge } from '@/components/visuals/PillarGauge'
import { CheckHeatmap, type HeatmapCheck } from '@/components/visuals/CheckHeatmap'
import type { OwnedResultEvidence } from '@/lib/result-evidence'
import type { PlatformStatus } from '@/lib/impact'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { getCheckExplanations }  from '@/lib/checkExplanations'
import type { Scan, CheckResult, ScanResults } from '@/lib/types'
import type { PublicResultSummary } from '@/lib/result-access'
import { consumeOneTimeFunnelEvent, trackFunnelEvent } from '@/lib/funnel-client'
import { factualDensityState, type FactualDensityView } from '@/lib/factual-density-evidence'
import { CHECK_SLOTS, bucketPoints, potentialScore, rankFixes, visualStatus } from '@/lib/result/view-model'

/* ── Helpers ────────────────────────────────────────────────── */
function getResult(results: Record<string, unknown>, key: string): CheckResult | undefined {
  const v = results[key]
  if (v && typeof v === 'object' && 'status' in (v as object)) return v as CheckResult
  return undefined
}

const PLATFORM_STATUS_LABELS: Record<'en' | 'zh-HK', Record<PlatformStatus, string>> = {
  en: { visible: 'Legacy technical estimate', partial: 'Legacy technical estimate', blocked: 'Legacy technical estimate', not_measured: 'Not measured' },
  'zh-HK': { visible: '歷史技術估算', partial: '歷史技術估算', blocked: '歷史技術估算', not_measured: '未量度' },
}

export function getPlatformStatusLabel(status: PlatformStatus, locale: string) {
  return PLATFORM_STATUS_LABELS[locale === 'zh-HK' ? 'zh-HK' : 'en'][status]
}

/* ── Main component ──────────────────────────────────────────── */
type Props = {
  lang: string
  summary: PublicResultSummary
  fullScan?: Scan
  ownedEvidence?: OwnedResultEvidence | null
  /** The owner's previous scan of the same domain; drives the one celebration. */
  previous?: { score: number; grade: string } | null
}

/**
 * The scan result, in the order a reader needs it: the score and what it
 * means, what fixing the top three would reach, the top three fixes, the
 * three areas, every check at a glance, then the filterable detail.
 *
 * Anonymous viewers see each check's verdict (no messages, details or
 * remediation from the scan); owners also get the scan's own findings.
 */
export function ResultClient({ lang, summary, fullScan, ownedEvidence, previous }: Props) {
  const t = useTranslations('resultPage')
  const checkNames = useTranslations('checks')
  const portfolio = useTranslations('portfolio')
  const catalogue = useMessages().checks as Record<string, string> | undefined
  const locale = useLocale()
  const resultViewTracked = useRef(false)
  const signupCtaTracked = useRef(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const owner = Boolean(fullScan)

  useEffect(() => {
    if (!consumeOneTimeFunnelEvent(resultViewTracked)) return
    const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
    trackFunnelEvent({ name: 'scan_result_viewed', locale, scanId: summary.id })
  }, [lang, summary.id])

  useEffect(() => {
    if (summary.collectionFailed || fullScan || !consumeOneTimeFunnelEvent(signupCtaTracked)) return
    const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
    trackFunnelEvent({ name: 'signup_cta_viewed', locale, scanId: summary.id })
  }, [fullScan, lang, summary.id, summary.collectionFailed])

  if (summary.collectionFailed) return <main className="mx-auto max-w-2xl space-y-4 px-4 py-12" data-testid="collection-failed">
    <p className="break-all text-sm text-muted-foreground">{summary.domain}</p>
    <h1 className="text-2xl font-bold">{t('collection_failed_title')}</h1>
    <p>{t('collection_failed_body')}</p>
    <Link href={`/${lang}/scan`} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-primary-foreground">{t('scan_another')}</Link>
  </main>

  if (summary.score === null || summary.grade === null) return <main className="mx-auto max-w-2xl space-y-4 px-4 py-12" data-testid="collection-unknown">
    <h1 className="text-2xl font-bold">{portfolio('scanUnknown')}</h1>
    <ScanEvidencePanel evidence={ownedEvidence ?? null} locale={locale} />
    <Link href={`/${lang}/scan`}>{t('scan_another')}</Link>
  </main>

  const score = summary.score
  const grade = summary.grade
  const assessments = summary.checks
  const topFixes = rankFixes(assessments).slice(0, 3)
  const potential = potentialScore(score, topFixes)
  const points = bucketPoints(assessments)
  const heatmapChecks: HeatmapCheck[] = CHECK_SLOTS.map(slot => ({
    key: slot.key, label: checkNames(slot.key), status: visualStatus(assessments[slot.key]), bucket: slot.bucket,
  }))
  const r = (fullScan?.results ?? {}) as Record<string, unknown>
  const topIssueResults = summary.topIssueKey && summary.topIssueStatus
    ? { [summary.topIssueKey]: { status: summary.topIssueStatus, assessment: summary.topIssueStatus, collection: 'complete', applicability: 'applicable', message: 'public_summary' } }
    : {}

  function goToSave() {
    setOpenKey(null)
    requestAnimationFrame(() => {
      const card = document.getElementById('save')
      card?.scrollIntoView({ block: 'start' })
      const target = document.getElementById('account-unlock-email') ?? card
      target?.focus({ preventScroll: true })
    })
  }

  // GEO rich data (owner only)
  type C17 = { qualityScore?: number; authorityBreakdown?: Record<string, number>; citationsPerThousandWords?: number; totalLinks?: number; externalLinks?: number }
  type C18 = FactualDensityView
  type C19 = { topicalCoverageScore?: number; totalClusters?: number; hasOrphanPages?: number; detectedClusters?: { topic: string; completenessScore: number }[] }
  type C20 = { avgChunkLength?: number; optimalChunkRatio?: number; totalChunks?: number; hasFaqStyle?: boolean; chunkAnalysis?: { heading: string; extractabilityScore: number; isAnswerFirst?: boolean; isSelfContained?: boolean }[] }

  const explanations = getCheckExplanations(locale)
  const renderOwnerRow = fullScan ? (key: string) => {
    const result = getResult(r, key)
    if (!result) return null
    return (
      <ExpandableCheckItem
        label={checkNames(key)}
        result={result}
        message={catalogue && Object.hasOwn(catalogue, result.message) ? catalogue[result.message]! : result.message}
        explanation={explanations[key]}
        factualState={key === 'c18_factual_density' ? factualDensityState(r.c18_factual_density_data ?? r.c18, result.diagnostic) : undefined}
      />
    )
  } : undefined

  return (
    <div className="min-h-screen bg-background">

      <nav className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur sm:px-6">
        <Link href={`/${lang}`} className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary">
            <Zap aria-hidden="true" className="size-3.5 text-primary-foreground" />
          </span>
          <span className="text-sm font-black text-foreground">Fimmick <span className="text-primary-accessible">AISO</span></span>
        </Link>
        <div className="flex items-center gap-2">
          <ResultActions domain={summary.domain} score={score} grade={grade} onSave={owner ? undefined : goToSave} />
          {owner && (
            <Link href={`/${lang}/pricing`} data-print-hide className="hidden min-h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-neutral-3 sm:inline-flex">
              {t('full_access')}
            </Link>
          )}
        </div>
      </nav>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:py-10">
        <ClaimScanOnReturn scanId={summary.id} lang={lang} />

        {/* 1. Score, grade and one line */}
        <section data-testid="result-score" className="flex flex-col gap-4">
          <ScoreReveal score={score} grade={grade} domain={summary.domain} industry={summary.industry} region={summary.region} previous={owner ? previous : null} />
          {topFixes.length > 0 && (
            <section aria-label={t('estimate_heading')} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <PotentialScoreBar current={score} potential={potential} />
              <p className="mt-3 text-xs text-muted-foreground">{t('estimate_heading')}</p>
            </section>
          )}
        </section>

        {/* 2. Top 3 fixes */}
        <section data-testid="result-top-issue" aria-labelledby="fixes-title" className="flex flex-col gap-3">
          <div>
            <h2 id="fixes-title" className="text-lg font-bold text-foreground">{t('fixes_title')}</h2>
            {topFixes.length > 0 && <p className="text-sm text-muted-foreground">{t('fixes_subtitle')}</p>}
          </div>
          {topFixes.length > 0
            ? <FixList fixes={topFixes} onSelect={setOpenKey} />
            : <TopIssueCard results={topIssueResults as ScanResults & Record<string, unknown>} failCount={0} priorityState={summary.priorityState} owner={owner} />}
        </section>

        {/* 3. Three areas */}
        <section aria-labelledby="pillars-title" className="flex flex-col gap-3">
          <h2 id="pillars-title" className="text-lg font-bold text-foreground">{t('pillars_title')}</h2>
          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 min-[480px]:grid-cols-3">
            <PillarGauge pillar="core" earned={points.core.earned} max={points.core.max} />
            <PillarGauge pillar="extended" earned={points.extended.earned} max={points.extended.max} />
            <PillarGauge pillar="geo" earned={points.geo.earned} max={points.geo.max} />
          </div>
        </section>

        {/* 4. Every check at a glance */}
        <section aria-labelledby="checks-title" className="flex flex-col gap-3">
          <div>
            <h2 id="checks-title" className="text-lg font-bold text-foreground">{t('checks_title')}</h2>
            <p className="text-sm text-muted-foreground">{t('checks_subtitle')}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <CheckHeatmap checks={heatmapChecks} onSelect={setOpenKey} selectedKey={openKey} />
          </div>
        </section>

        {/* 5. Filterable detail */}
        <section aria-labelledby="list-title" className="flex flex-col gap-3">
          <h2 id="list-title" className="text-lg font-bold text-foreground">{t('list_title')}</h2>
          <CheckList assessments={assessments} onSelect={setOpenKey} renderOwnerRow={renderOwnerRow} />
        </section>

        {fullScan && (
          <>
            <ScanEvidencePanel evidence={ownedEvidence ?? null} locale={locale} />
            <DeepGeoSection
              c17={(r['c17_citation_density_data'] ?? r['c17']) as C17 | undefined}
              c18={(r['c18_factual_density_data'] ?? r['c18']) as C18 | undefined}
              c19={(r['c19_topical_authority_data'] ?? r['c19']) as C19 | undefined}
              c19Check={r.c19_topical_authority}
              c20={(r['c20_chunkability_data'] ?? r['c20']) as C20 | undefined}
            />
            <TrustSignalsSection value={r.trust_signals} />
          </>
        )}

        <PlatformPanel summary={summary} locale={locale} />

        {fullScan ? (
          <Link
            href={`/${lang}/dashboard`}
            data-testid="fix-pack-action"
            data-print-hide
            className="block rounded-2xl bg-foreground px-6 py-4 text-center text-sm font-bold text-background transition hover:bg-foreground/90"
          >
            {t('fix_pack')}
          </Link>
        ) : (
          <div id="save" tabIndex={-1} className="scroll-mt-20 focus:outline-none" data-print-hide>
            <AccountUnlockCard scanId={summary.id} lang={lang} />
          </div>
        )}

        <div className="pb-4 text-center" data-print-hide>
          <Link href={`/${lang}`} className="text-sm text-muted-foreground underline underline-offset-2 transition hover:text-foreground">
            {t('scan_another')}
          </Link>
        </div>
      </main>

      <FixDrawer
        lang={lang}
        checkKey={openKey}
        assessment={openKey ? assessments[openKey] : undefined}
        owner={owner}
        onClose={() => setOpenKey(null)}
        onSignup={goToSave}
      />
    </div>
  )
}

/** Consumer exposure is not measured by a technical scan; crawler access is listed as collected. */
function PlatformPanel({ summary, locale }: { summary: PublicResultSummary; locale: string }) {
  const t = useTranslations('resultPage')
  return (
    <section aria-label={t('platforms_title')} className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-1 text-sm font-bold text-foreground">{t('platforms_title')}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{t('platforms_note')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {summary.teaser.platformVisibility.map(platform => (
          <div key={platform.platform} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-foreground">{platform.label}</span>
            <span
              data-status={platform.status}
              aria-label={`${platform.label}: ${getPlatformStatusLabel(platform.status, locale)}`}
              className="rounded-full bg-neutral-3 px-2 py-0.5 text-xs font-semibold text-foreground"
            >
              {getPlatformStatusLabel(platform.status, locale)}
            </span>
          </div>
        ))}
      </div>
      {(summary.teaser.collectorAccess ?? []).length > 0 && <ul className="mt-4 space-y-2 text-xs text-muted-foreground" aria-label={t('crawler_label')}>
        {summary.teaser.collectorAccess.map(collector => <li key={collector.crawler}>
          {collector.crawler} · {locale === 'zh-HK'
            ? ({ search: '搜尋', training: '訓練', user_triggered: '使用者觸發' }[collector.role]) : collector.role.replace('_', ' ')} · {locale === 'zh-HK'
            ? `規則：${{ allowed: '允許', blocked: '封鎖', unknown: '未知' }[collector.policy]}；抓取：${{ reachable: '可存取', unreachable: '不可存取', not_measured: '未量度' }[collector.probe]}`
            : `Policy: ${collector.policy}; fetch: ${collector.probe.replace('_', ' ')}`}
        </li>)}
      </ul>}
    </section>
  )
}
