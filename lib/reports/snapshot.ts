import {projectScanStatus} from '@/lib/view-models/scan-status'
import { hasFailedScanPage, publicCheckAssessments } from '@/lib/result-access'
import { CHECK_SLOTS } from '@/lib/result/view-model'
import { compareScanEvidence, readScanEvidence } from '@/lib/scan-evidence'
import { compareReportEvidence, isReportEvidence, normalizeReportDomain, parseReportTimestamp, REPORTABLE_CHECKS } from './comparison'
import { buildDeterministicReportSummary } from './summary'
import { REPORT_TREND_MAX } from './visuals'
import {
  REPORT_LOCALES,
  REPORT_SNAPSHOT_SCHEMA_VERSION,
  type ClientReportSnapshotV1,
  type ReportBrandingInput,
  type ReportClientInput,
  type ReportLocale,
  type ReportPriorityFix,
  type ReportRecommendationInput,
  type ReportScanInput,
  type ReportCheckStatus,
  type ReportTrendPoint,
} from './types'

export interface ClientReportSnapshotInput {
  readonly locale: ReportLocale
  readonly branding: ReportBrandingInput
  readonly client: ReportClientInput
  readonly currentScan: ReportScanInput
  readonly previousScan: ReportScanInput | null
  readonly recommendations: ReadonlyArray<ReportRecommendationInput>
  /** Earlier scans for the score trend, any order; unusable ones are skipped. */
  readonly history?: ReadonlyArray<ReportScanInput>
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function requiredText(value: string, field: string): string {
  const normalized = normalizeText(value)
  if (!normalized || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${field} must be plain text`)
  return normalized
}

function optionalText(value: string | null, field: string): string | null {
  return value === null ? null : requiredText(value, field)
}

function validDate(value: string, field: string): string {
  if (parseReportTimestamp(value) === null) throw new Error(`${field} must be a strict ISO timestamp`)
  return value
}

function buildFixes(
  recommendations: ReadonlyArray<ReportRecommendationInput>,
  changes: ReadonlyArray<{ key: string; label: string; kind: string }>,
  results: unknown,
): ReadonlyArray<ReportPriorityFix> {
  const recommendationFixes = recommendations.map(recommendation => ({
    key: requiredText(recommendation.key, 'recommendation key'),
    title: requiredText(recommendation.title, 'recommendation title'),
    rationale: requiredText(recommendation.rationale, 'recommendation rationale'),
    expectedImpact: recommendation.expectedImpact,
    nextStep: requiredText(recommendation.nextStep, 'recommendation next step'),
  }))
  const seen = new Set<string>()
  const uniqueRecommendations = recommendationFixes.filter(fix => {
    const identity = `${fix.title}\n${fix.rationale}\n${fix.nextStep}`.toLowerCase()
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
  const regressionFixes = changes.filter(change => change.kind === 'regressed').map(change => ({
    key: change.key, title: `Address regression: ${change.label}`,
    rationale: 'This reportable check has regressed since the earlier scan.', expectedImpact: 'high' as const,
    nextStep: `Review and improve ${change.label}.`,
  }))
  const resultRecord = typeof results === 'object' && results !== null && !Array.isArray(results)
    ? results as Record<string, unknown> : {}
  const statusFixes = (status: 'fail' | 'warn', impact: 'high' | 'medium') => REPORTABLE_CHECKS
    .filter(key => typeof resultRecord[key] === 'object' && resultRecord[key] !== null
      && (resultRecord[key] as Record<string, unknown>).status === status)
    .map(key => ({
      key, title: `${status === 'fail' ? 'Resolve failure' : 'Review warning'}: ${key}`,
      rationale: `The current scan reports a ${status} for this check.`, expectedImpact: impact,
      nextStep: `Review ${key} and apply the recommended correction.`,
    }))
  const allFixes = [...uniqueRecommendations, ...regressionFixes, ...statusFixes('fail', 'high'), ...statusFixes('warn', 'medium')]
  const usedKeys = new Set<string>()
  return allFixes.filter(fix => {
    if (usedKeys.has(fix.key)) return false
    usedKeys.add(fix.key)
    return true
  }).slice(0, 5)
}

function reportChecks(results: unknown): Record<string, ReportCheckStatus> {
  const assessments = publicCheckAssessments(results as Record<string, unknown>)
  return Object.fromEntries(CHECK_SLOTS.map(slot => [slot.key, assessments[slot.key] ?? 'unknown']))
}

function evidenceOf(scan: ReportScanInput): unknown {
  return (scan.results as Record<string, unknown>).evidence
}

/** The displayed score, or null when the scan cannot be shown as scored. */
function trendScore(scan: ReportScanInput): number | null {
  if (!isReportEvidence(scan.results) || hasFailedScanPage(scan.results)) return null
  return projectScanStatus({ score: scan.score, grade: scan.grade, evidence: evidenceOf(scan) }).score
}

/**
 * Up to eight scores ending on the current scan, for the same account and
 * domain. Each point says whether it was collected the same way as the one
 * before, so a method change is labelled rather than read as progress.
 */
function reportTrend(current: ReportScanInput, history: ReadonlyArray<ReportScanInput>): ReportTrendPoint[] | undefined {
  const domain = normalizeReportDomain(current.domain)
  const currentTime = parseReportTimestamp(current.createdAt)!
  const earlier = history
    .filter(scan => scan.accountId === current.accountId && normalizeReportDomain(scan.domain) === domain)
    .filter(scan => { const time = parseReportTimestamp(scan.createdAt); return time !== null && time < currentTime })
    .filter(scan => trendScore(scan) !== null)
    .sort((a, b) => parseReportTimestamp(a.createdAt)! - parseReportTimestamp(b.createdAt)!)
    .slice(-(REPORT_TREND_MAX - 1))
  if (!earlier.length) return undefined
  const scans = [...earlier, current]
  return scans.map((scan, index) => ({
    date: scan.createdAt,
    score: scan === current ? current.score : trendScore(scan)!,
    comparable: index === 0 || compareScanEvidence(evidenceOf(scans[index - 1]!), evidenceOf(scan)).comparable,
  }))
}

export function buildClientReportSnapshot(input: ClientReportSnapshotInput): ClientReportSnapshotV1 {
  if (!REPORT_LOCALES.includes(input.locale)) throw new Error('Unsupported report locale')
  const domain = normalizeReportDomain(input.client.domain)
  if (!domain) throw new Error('Client domain must be a valid public domain')
  const currentDomain = normalizeReportDomain(input.currentScan.domain)
  if (!currentDomain || currentDomain !== domain || !input.currentScan.accountId || !isReportEvidence(input.currentScan.results)) throw new Error('Current scan must match the client evidence scope')
  if (hasFailedScanPage(input.currentScan.results as Record<string, unknown>) || (input.previousScan && hasFailedScanPage(input.previousScan.results as Record<string, unknown>))) throw new Error('Failed collection cannot produce a scored report')
  for(const scan of [input.currentScan,input.previousScan])if(scan&&projectScanStatus({score:scan.score,grade:scan.grade,evidence:(scan.results as Record<string,unknown>).evidence}).score===null)throw new Error('Unverified collection cannot produce a scored report')
  if (!Number.isFinite(input.currentScan.score)) throw new Error('Current score must be finite')
  const scanDate = validDate(input.currentScan.createdAt, 'Current scan date')
  const previousDate = input.previousScan ? validDate(input.previousScan.createdAt, 'Previous scan date') : null
  if (input.previousScan) {
    const previousDomain = normalizeReportDomain(input.previousScan.domain)
    if (input.previousScan.accountId !== input.currentScan.accountId || previousDomain !== currentDomain || !isReportEvidence(input.previousScan.results) || !Number.isFinite(input.previousScan.score) || parseReportTimestamp(input.previousScan.createdAt)! >= parseReportTimestamp(input.currentScan.createdAt)!) {
      throw new Error('Previous scan must be earlier evidence for the same account and domain')
    }
  }
  const evidenceComparison = input.previousScan ? compareScanEvidence(
        (input.previousScan.results as Record<string, unknown>).evidence,
        (input.currentScan.results as Record<string, unknown>).evidence,
      ) : null
  const comparison = input.previousScan
    ? evidenceComparison?.comparable
      ? compareReportEvidence(input.currentScan.results, input.previousScan.results)
      : { comparisonState: 'not_comparable' as const, changes: [] }
    : { comparisonState: 'baseline' as const, changes: [] }
  const comparable = comparison.comparisonState === 'comparable' && input.previousScan !== null && Number.isFinite(input.previousScan.score)
  const comparisonState = comparable ? 'comparable' : comparison.comparisonState
  const score = comparable && input.previousScan && previousDate
    ? {
        current: input.currentScan.score, grade: requiredText(input.currentScan.grade, 'Current grade'), comparisonState,
        previous: input.previousScan.score, delta: input.currentScan.score - input.previousScan.score, previousScanDate: previousDate,
      }
    : { current: input.currentScan.score, grade: requiredText(input.currentScan.grade, 'Current grade'), comparisonState }
  const branding = {
    agencyName: requiredText(input.branding.agencyName, 'Agency name'),
    logoUrl: optionalText(input.branding.logoUrl, 'Logo URL'),
    primaryColor: requiredText(input.branding.primaryColor, 'Primary color'),
    contactLabel: optionalText(input.branding.contactLabel, 'Contact label'),
    contactUrl: optionalText(input.branding.contactUrl, 'Contact URL'),
    attribution: 'Powered by Fimmick AISO' as const,
  }
  const priorityFixes = buildFixes(input.recommendations, comparison.changes, input.currentScan.results)
  const executiveSummary = buildDeterministicReportSummary({
    locale: input.locale, comparisonState, currentScore: input.currentScan.score,
    delta: 'delta' in score ? score.delta : undefined, changes: comparison.changes,
  })
  const trend = reportTrend(input.currentScan, input.history ?? [])
  const coverage = readScanEvidence((input.currentScan.results as Record<string, unknown>).evidence)!
  const collectionLabel = input.locale === 'zh-HK'
    ? coverage.collection === 'complete' ? '完整' : '部分' : coverage.collection
  const reasons = input.locale === 'zh-HK' ? {
    baseline: '未選取較早掃描作比較。', comparable: '比較只限於完整採集且保留頁面身份及方法一致的檢查。',
    'unknown-evidence': '較早或目前的採集證據未能核實，不能量度變化。',
    'different-methods-or-scope': '所選掃描的方法或範圍不同，不能量度可比較的變化。',
    'incomplete-collection': '部分採集不能量度可比較的變化。',
    'final-path-identity-withheld': '證據僅保留網站來源，確切頁面身份未保留，不能量度可比較的變化。',
  } : {
    baseline: 'No earlier scan was selected for comparison.', comparable: 'Comparison is limited to complete collection with matching retained page identity and methods.',
    'unknown-evidence': 'Current or earlier collection evidence is unverified; no measured change is established.',
    'different-methods-or-scope': 'The selected scans have different methods or scope; no comparable change is established.',
    'incomplete-collection': 'Partial collection does not establish comparable change.',
    'final-path-identity-withheld': 'Evidence retains origin-only identity; exact page identity is withheld and no comparable change is established.',
  }
  const identityLimited = !coverage.final || coverage.final.pathRedacted || coverage.final.queryRedacted || coverage.final.fragmentRedacted || coverage.final.originNormalized
  const identityNote = identityLimited
    ? input.locale === 'zh-HK' ? 'URL 證據僅保留網站來源。' : 'URL evidence retains origin-only identity.' : ''
  const comparisonNote = !input.previousScan ? reasons.baseline : comparable ? reasons.comparable
    : reasons[evidenceComparison?.reason ?? 'unknown-evidence']
  const methodology = input.locale === 'zh-HK'
    ? `分數只根據此掃描已採集的檢查。採集狀態：${collectionLabel}；完成頁數：${coverage.completedPages}。${identityNote}${comparisonNote}技術分數並非消費者 AI 曝光量度。`
    : `Scores use checks captured in this scan. Collection coverage: ${collectionLabel}; completed pages: ${coverage.completedPages}. ${identityNote} ${comparisonNote} Technical scores do not measure consumer AI visibility.`
  return {
    snapshotSchemaVersion: REPORT_SNAPSHOT_SCHEMA_VERSION,
    locale: input.locale,
    branding,
    client: { name: requiredText(input.client.name, 'Client name'), domain },
    evidence: { scanDate, evidenceTimestamp: scanDate },
    score,
    changes: comparison.changes,
    priorityFixes,
    executiveSummary,
    methodology,
    checks: reportChecks(input.currentScan.results),
    ...(trend ? { trend } : {}),
  }
}

export function replaceExecutiveSummary(snapshot: ClientReportSnapshotV1, summary: string): ClientReportSnapshotV1 {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(summary)) throw new Error('Summary must not contain control characters')
  const normalized = normalizeText(summary)
  if (normalized.length < 40 || normalized.length > 1200) throw new Error('Summary must be between 40 and 1200 characters')
  return { ...snapshot, executiveSummary: normalized }
}
