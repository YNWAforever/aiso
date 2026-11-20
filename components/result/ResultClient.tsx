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
import dynamic from 'next/dynamic'
import { CheckList } from './CheckList'
import { RevealPotentialBar } from '@/components/visuals/reveal/RevealPotentialBar'
import { RevealPillarGauge } from '@/components/visuals/reveal/RevealPillarGauge'
import { RevealHeatmap } from '@/components/visuals/reveal/RevealHeatmap'
import { RevealObserver } from '@/components/visuals/reveal/RevealObserver'
import type { HeatmapCheck } from '@/components/visuals/CheckHeatmap'
import type { OwnedResultEvidence } from '@/lib/result-evidence'
import { deriveCollectorAccess } from '@/lib/impact'
import { CrawlerAccessEvidence } from './CrawlerAccessEvidence'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { getCheckActionCopy, getCheckExplanations } from '@/lib/checkExplanations'
import type { CheckResult, ScanResults } from '@/lib/types'
import type { PublicResultSummary } from '@/lib/result-access'
import { consumeOneTimeFunnelEvent, trackFunnelEvent } from '@/lib/funnel-client'
import { factualDensityState, type FactualDensityView } from '@/lib/factual-density-evidence'
import { CHECK_SLOTS, bucketPoints, geoScale, potentialScore, rankFixes, visualStatus } from '@/lib/result/view-model'
import { FixPackClient } from '@/components/FixPackClient'
import { Wordmark } from '@/components/brand/Wordmark'
import { PrintButton, PrintThemeGuard } from '@/components/reports/PrintButton'
import { scanReportHref } from '@/lib/result/links'
import { formatDisplayDate } from '@/lib/format/date'

// The drawer (and its dialog primitive) loads the first time a check is opened.
const FixDrawer = dynamic(() => import('@/components/result/FixDrawer').then(module => module.FixDrawer), { ssr: false })

/* ── Helpers ────────────────────────────────────────────────── */
function getResult(results: Record<string, unknown>, key: string): CheckResult | undefined {
  const v = results[key]
  if (v && typeof v === 'object' && 'status' in v && 'message' in v && typeof v.message === 'string') return v as CheckResult
  return undefined
}

/* ── Main component ──────────────────────────────────────────── */
type Props = {
  lang: string
  summary: PublicResultSummary
  fullScan?: { id: string; results: Record<string, unknown> }
  ownedBrandId?: string
  ownedEvidence?: OwnedResultEvidence | null
  /** The owner's previous scan of the same domain; drives the one celebration. */
  previous?: { score: number; grade: string } | null
  workspace?: { clientId: string; canShare: boolean }
}

/**
 * The scan result, in the order a reader needs it: the score and what it
 * means, what fixing the top three would reach, the top three fixes, the
 * three areas, every check at a glance, then the filterable detail.
 *
 * Anonymous viewers see each check's verdict (no messages, details or
 * remediation from the scan); owners also get the scan's own findings.
 */
export function ResultClient({ lang, summary, fullScan, ownedBrandId, ownedEvidence, previous, workspace }: Props) {
  const t = useTranslations('resultPage')
  const checkNames = useTranslations('checks')
  const generated = useTranslations('generatedWork')
  const result = useTranslations('result')
  const portfolio = useTranslations('portfolio')
  const visuals = useTranslations('visuals')
  const reports = useTranslations('reports')
  const evidence = useTranslations('scanEvidence')
  const catalogue = useMessages().checks as Record<string, string> | undefined
  const locale = useLocale()
  const resultViewTracked = useRef(false)
  const signupCtaTracked = useRef(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [drawerLoaded, setDrawerLoaded] = useState(false)
  // Where focus goes back to when the drawer closes, unless the reader went to sign up.
  const opener = useRef<HTMLElement | null>(null)
  const returnFocus = useRef(true)
  const pendingAnchor = useRef<'save' | 'fix-pack' | null>(null)
  function openCheck(key: string) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    returnFocus.current = true
    setDrawerLoaded(true)
    setOpenKey(key)
    trackFunnelEvent({ name: 'fix_opened', locale: lang === 'zh-HK' ? 'zh-HK' : 'en', scanId: summary.id })
  }
  const owner = Boolean(fullScan)
  const brandHref = workspace ? `/${lang}/dashboard/${encodeURIComponent(workspace.clientId)}` : null
  const selectedScan = `scanId=${encodeURIComponent(summary.id)}`
  const rescanHref = brandHref ? `${brandHref}?step=scan&${selectedScan}` : `/${lang}/scan`
  const separateFixPackHref = !workspace && ownedBrandId ? `${scanReportHref(lang, ownedBrandId, summary.id)}#fix-pack` : undefined
  const resultsHref = brandHref ? `${brandHref}?step=results&${selectedScan}` : null

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
    {workspace && <ScanEvidencePanel evidence={ownedEvidence ?? null} />}
    <Link href={rescanHref} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-primary-foreground">{t('scan_another')}</Link>
    {resultsHref && <Link href={resultsHref} className="ms-4 text-primary-accessible underline">{result('back_to_results')}</Link>}
  </main>

  if (summary.score === null || summary.grade === null) return <main className="mx-auto max-w-2xl space-y-4 px-4 py-12" data-testid="collection-unknown">
    <h1 className="text-2xl font-bold">{portfolio('scanUnknown')}</h1>
    <ScanEvidencePanel evidence={ownedEvidence ?? null} />
    <Link href={rescanHref} className="inline-flex min-h-11 items-center text-primary-accessible underline">{t('scan_another')}</Link>
    {resultsHref && <Link href={resultsHref} className="ms-4 text-primary-accessible underline">{result('back_to_results')}</Link>}
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
  const r = fullScan?.results ?? {}
  const topIssueResults = summary.topIssueKey && summary.topIssueStatus
    ? { [summary.topIssueKey]: { status: summary.topIssueStatus, assessment: summary.topIssueStatus, collection: 'complete', applicability: 'applicable', message: 'public_summary' } }
    : {}

  function focusSection(id: 'save' | 'fix-pack') {
    const section = document.getElementById(id)
    section?.scrollIntoView({ block: 'start' })
    const target = id === 'save' ? document.getElementById('account-unlock-email') ?? section : section
    target?.focus({ preventScroll: true })
  }

  function goToSection(id: 'save' | 'fix-pack') {
    if (openKey === null) { focusSection(id); return }
    returnFocus.current = false
    pendingAnchor.current = id
    setOpenKey(null)
  }

  function onDrawerClosed() {
    const target = pendingAnchor.current
    pendingAnchor.current = null
    if (target) focusSection(target)
    else if (returnFocus.current) opener.current?.focus()
  }

  // GEO rich data (owner only)
  type C17 = { qualityScore?: number; authorityBreakdown?: Record<string, number>; citationsPerThousandWords?: number; totalLinks?: number; externalLinks?: number }
  type C18 = FactualDensityView
  type C19 = { topicalCoverageScore?: number; totalClusters?: number; hasOrphanPages?: number; detectedClusters?: { topic: string; completenessScore: number }[] }
  type C20 = { avgChunkLength?: number; optimalChunkRatio?: number; totalChunks?: number; hasFaqStyle?: boolean; chunkAnalysis?: { heading: string; extractabilityScore: number; isAnswerFirst?: boolean; isSelfContained?: boolean }[] }

  const explanations = getCheckExplanations(locale)
  const renderOwnerRow = fullScan ? (key: string) => {
    const result = getResult(r, key)
    const assessment = assessments[key] ?? 'unknown'
    if (!result) return workspace ? (
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-3 text-sm">
        <span className="font-medium">{checkNames(key)}</span><span className="text-muted-foreground">{evidence(`states.${assessment}`)}</span>
      </div>
    ) : null
    const crawlerKind = key === 'c1_robots' ? 'policy' : key === 'c3_bot_access' ? 'probe' : null
    return (
      <ExpandableCheckItem
        label={checkNames(key)}
        result={result}
        message={catalogue && Object.hasOwn(catalogue, result.message) ? catalogue[result.message]! : result.message}
        explanation={explanations[key]}
        assessment={workspace ? assessment : undefined}
        factualState={key === 'c18_factual_density' ? factualDensityState(r.c18_factual_density_data ?? r.c18, result.diagnostic) : undefined}
      >
        {crawlerKind && <CrawlerAccessEvidence entries={deriveCollectorAccess({ [key]: result })} kind={crawlerKind} />}
      </ExpandableCheckItem>
    )
  } : undefined

  return (
    <div className={workspace ? 'min-w-0 bg-background print:bg-white' : 'min-h-screen bg-background'}>
      {workspace && brandHref && resultsHref ? (
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 pt-5 sm:px-6 print:hidden">
          <Link href={resultsHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline underline-offset-4">{result('back_to_results')}</Link>
          <div className="flex flex-wrap gap-2">
            <Link href={`${brandHref}?step=improve&${selectedScan}`} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{result('improve_with_agents')}</Link>
            {workspace.canShare && <Link href={`${brandHref}/reports/new?${selectedScan}`} className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{reports('create_share_report')}</Link>}
            <PrintButton />
          </div>
        </div>
      ) : <nav className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur sm:px-6">
        <Link href={`/${lang}`} className="flex shrink-0 items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary">
            <Zap aria-hidden="true" className="size-3.5 text-primary-foreground" />
          </span>
          <Wordmark className="whitespace-nowrap text-sm font-black text-foreground" accentClassName="text-primary-accessible" />
        </Link>
        <div className="flex items-center gap-2">
          <ResultActions domain={summary.domain} score={score} grade={grade} onSave={owner ? undefined : () => goToSection('save')} />
          {owner && (
            <Link href={`/${lang}/pricing`} data-print-hide className="hidden min-h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-neutral-3 sm:inline-flex">
              {t('full_access')}
            </Link>
          )}
        </div>
      </nav>}

      <main className={workspace ? 'mx-auto flex max-w-5xl flex-col gap-8 px-4 py-6 sm:px-6 print:max-w-none print:p-0' : 'mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:py-10'}>
        {workspace ? <>
          <PrintThemeGuard />
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <p className="font-semibold text-foreground">{t('workspace_label')}</p>
            {summary.createdAt && <time className="text-muted-foreground" dateTime={summary.createdAt}>{t('scan_date', { date: formatDisplayDate(summary.createdAt, locale) })}</time>}
          </div>
        </> : <ClaimScanOnReturn scanId={summary.id} lang={lang} />}

        {/* 1. Score, grade and one line */}
        <section data-testid="result-score" className="flex flex-col gap-4">
          <ScoreReveal score={score} grade={grade} domain={summary.domain} industry={summary.industry} region={summary.region} previous={owner ? previous : null} />
          {topFixes.length > 0 && (
            <section data-reveal aria-label={t('estimate_heading')} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <RevealPotentialBar current={score} potential={potential} />
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
            ? <FixList fixes={topFixes} onSelect={openCheck} renderDetail={workspace ? fix => {
                const observed = getResult(r, fix.key)
                const finding = observed?.status === fix.assessment && catalogue && Object.hasOwn(catalogue, observed.message)
                  ? catalogue[observed.message] : visuals(`status.${fix.assessment}`)
                const change = explanations[fix.key]?.fix[fix.assessment]
                const verify = getCheckActionCopy(fix.key, locale)?.nextStep ?? t('verify_rescan')
                return <dl className="grid gap-3 border-t border-border px-4 py-3 text-sm sm:grid-cols-3">
                  <div><dt className="font-semibold">{t('fix_finding')}</dt><dd className="mt-1 break-words text-muted-foreground">{finding}</dd></div>
                  <div><dt className="font-semibold">{t('drawer.how')}</dt><dd className="mt-1 break-words text-muted-foreground">{change}</dd></div>
                  <div><dt className="font-semibold">{t('fix_verification')}</dt><dd className="mt-1 break-words text-muted-foreground">{verify}</dd></div>
                </dl>
              } : undefined} />
            : <TopIssueCard results={topIssueResults as ScanResults & Record<string, unknown>} failCount={0} priorityState={summary.priorityState} owner={owner} />}
        </section>

        {/* 3. Three areas */}
        <section aria-labelledby="pillars-title" className="flex flex-col gap-3">
          <h2 id="pillars-title" className="text-lg font-bold text-foreground">{t('pillars_title')}</h2>
          <div data-reveal className="grid grid-cols-3 gap-2 rounded-2xl border border-border bg-card p-3 sm:gap-3 sm:p-4">
            <RevealPillarGauge pillar="core" earned={points.core.earned} max={points.core.max} />
            <RevealPillarGauge pillar="extended" earned={points.extended.earned} max={points.extended.max} />
            <RevealPillarGauge pillar="geo" earned={points.geo.earned} max={points.geo.max} />
          </div>
        </section>

        {/* 4. Every check at a glance */}
        <section aria-labelledby="checks-title" className="flex flex-col gap-3">
          <div>
            <h2 id="checks-title" className="text-lg font-bold text-foreground">{t('checks_title')}</h2>
            <p className="text-sm text-muted-foreground">{t('checks_subtitle')}</p>
          </div>
          <div data-reveal className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <RevealHeatmap checks={heatmapChecks} onSelect={openCheck} selectedKey={openKey} />
          </div>
        </section>

        {/* 5. Filterable detail */}
        <section aria-labelledby="list-title" className="flex flex-col gap-3">
          <h2 id="list-title" className="text-lg font-bold text-foreground">{t('list_title')}</h2>
          <CheckList assessments={assessments} onSelect={openCheck} renderOwnerRow={renderOwnerRow} />
        </section>

        {fullScan && (
          <>
            <ScanEvidencePanel evidence={ownedEvidence ?? null} />
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

        {fullScan ? separateFixPackHref ? (
          <Link
            href={separateFixPackHref}
            data-testid="fix-pack-action"
            data-print-hide
            className="block rounded-2xl bg-foreground px-6 py-4 text-center text-sm font-bold text-background transition hover:bg-foreground/90"
          >
            {t('fix_pack')}
          </Link>
        ) : (
          <section id="fix-pack" tabIndex={-1} data-testid="fix-pack-action" data-print-hide className="scroll-mt-24 space-y-3 focus-visible:outline-2 focus-visible:outline-primary">
            <h2 className="font-semibold">{generated('packTitle')}</h2>
            <FixPackClient scanId={fullScan.id} fixCta={generated('packCta')} fixSubtitle={generated('draftNotice')}
              copyLabel={result('copy')} copiedLabel={result('copied')} />
            {!workspace && <Link href={`/${lang}/onboarding?scan=${encodeURIComponent(fullScan.id)}`}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline underline-offset-4">
              {t('set_up_brand')}
            </Link>}
          </section>
        ) : (
          <div id="save" tabIndex={-1} className="scroll-mt-20 focus:outline-none" data-print-hide>
            <AccountUnlockCard scanId={summary.id} lang={lang} />
          </div>
        )}

        <div className="pb-4 text-center" data-print-hide>
          <Link href={workspace ? rescanHref : `/${lang}`} className="text-sm text-muted-foreground underline underline-offset-2 transition hover:text-foreground">
            {t('scan_another')}
          </Link>
        </div>
      </main>

      <RevealObserver />
      {drawerLoaded && <FixDrawer
        lang={lang}
        checkKey={openKey}
        assessment={openKey ? assessments[openKey] : undefined}
        owner={owner}
        onClose={() => setOpenKey(null)}
        onClosed={onDrawerClosed}
        onSignup={() => goToSection('save')}
        fixPackHref={separateFixPackHref}
        onOpenFixPack={owner && !separateFixPackHref ? () => goToSection('fix-pack') : undefined}
        geoScale={geoScale(assessments)}
      />}
    </div>
  )
}
