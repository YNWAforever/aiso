import { compareReportEvidence, isReportEvidence, normalizeReportDomain, parseReportTimestamp, REPORTABLE_CHECKS } from './comparison'
import { buildDeterministicReportSummary } from './summary'
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
} from './types'

export interface ClientReportSnapshotInput {
  readonly locale: ReportLocale
  readonly branding: ReportBrandingInput
  readonly client: ReportClientInput
  readonly currentScan: ReportScanInput
  readonly previousScan: ReportScanInput | null
  readonly recommendations: ReadonlyArray<ReportRecommendationInput>
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

export function buildClientReportSnapshot(input: ClientReportSnapshotInput): ClientReportSnapshotV1 {
  if (!REPORT_LOCALES.includes(input.locale)) throw new Error('Unsupported report locale')
  const domain = normalizeReportDomain(input.client.domain)
  if (!domain) throw new Error('Client domain must be a valid public domain')
  const currentDomain = normalizeReportDomain(input.currentScan.domain)
  if (!currentDomain || currentDomain !== domain || !input.currentScan.accountId || !isReportEvidence(input.currentScan.results)) throw new Error('Current scan must match the client evidence scope')
  if (!Number.isFinite(input.currentScan.score)) throw new Error('Current score must be finite')
  const scanDate = validDate(input.currentScan.createdAt, 'Current scan date')
  const previousDate = input.previousScan ? validDate(input.previousScan.createdAt, 'Previous scan date') : null
  if (input.previousScan) {
    const previousDomain = normalizeReportDomain(input.previousScan.domain)
    if (input.previousScan.accountId !== input.currentScan.accountId || previousDomain !== currentDomain || !isReportEvidence(input.previousScan.results) || !Number.isFinite(input.previousScan.score) || parseReportTimestamp(input.previousScan.createdAt)! >= parseReportTimestamp(input.currentScan.createdAt)!) {
      throw new Error('Previous scan must be earlier evidence for the same account and domain')
    }
  }
  const comparison = input.previousScan
    ? compareReportEvidence(input.currentScan.results, input.previousScan.results)
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
    methodology: 'Scores and changes are based only on the reportable checks captured in the selected scans.',
  }
}

export function replaceExecutiveSummary(snapshot: ClientReportSnapshotV1, summary: string): ClientReportSnapshotV1 {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(summary)) throw new Error('Summary must not contain control characters')
  const normalized = normalizeText(summary)
  if (normalized.length < 40 || normalized.length > 1200) throw new Error('Summary must be between 40 and 1200 characters')
  return { ...snapshot, executiveSummary: normalized }
}
