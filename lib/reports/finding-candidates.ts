import { deriveSuggestions } from '@/lib/opportunities/rules'
import type {
  ReportFindingProvenance,
  SafeObservationEvidence,
  SourceRef,
} from '@/lib/opportunities/types'
import { readScanEvidence } from '@/lib/scan-evidence'
import type { ClientReportSnapshotV1, ReportLocale } from './types'

export interface ReportFindingCandidate {
  checkKey: ReportFindingProvenance['findingKey']
  title: string
  rationale: string
  expectedImpact: ReportFindingProvenance['expectedImpact']
  nextStep: string
  rank: number
  source: SourceRef
  ruleVersion: 'scan-check-gap.v1'
  fingerprint: string
  targetUrl: string | null
  observations: SafeObservationEvidence[]
  reportProvenance: ReportFindingProvenance
}

function evidenceEnvelope(results: unknown): unknown {
  if (results && typeof results === 'object' && !Array.isArray(results)
    && Object.hasOwn(results, 'evidence')) {
    return (results as { evidence: unknown }).evidence
  }
  return results
}

/**
 * Report priority fixes are already ranked. This adapter selects only fixes that
 * still have a matching actionable check in the immutable source scan.
 */
export function buildReportFindingCandidates(input: {
  reportId: string
  reportVersionId: string
  reportVersionNumber: number
  reportCreatedAt: string
  scanId: string
  scanCreatedAt: string
  scanResults: unknown
  snapshot: ClientReportSnapshotV1
  locale: ReportLocale
}): ReportFindingCandidate[] {
  if (input.snapshot.locale !== input.locale) return []
  const envelope = readScanEvidence(evidenceEnvelope(input.scanResults))
  if (!envelope) return []
  const suggestions = deriveSuggestions({
    kind: 'scan-check',
    scanId: input.scanId,
    recordedAt: input.scanCreatedAt,
    envelope,
  })
  const byCheck = new Map(suggestions.flatMap(suggestion =>
    suggestion.source.kind === 'scan-check' && suggestion.source.checkKey
      ? [[suggestion.source.checkKey, suggestion] as const] : []))

  return input.snapshot.priorityFixes.flatMap((fix, index) => {
    if (!Object.hasOwn(envelope.checks, fix.key)) return []
    const checkKey = fix.key as ReportFindingProvenance['findingKey']
    const suggestion = byCheck.get(checkKey)
    if (!suggestion || suggestion.evidence.kind !== 'scan-check'
      || suggestion.ruleVersion !== 'scan-check-gap.v1') return []
    const targetUrl = suggestion.evidence.evaluated.origin
    return [{
      checkKey,
      title: fix.title,
      rationale: fix.rationale,
      expectedImpact: fix.expectedImpact,
      nextStep: fix.nextStep,
      rank: index + 1,
      source: suggestion.source,
      ruleVersion: 'scan-check-gap.v1',
      fingerprint: suggestion.fingerprint,
      targetUrl,
      observations: suggestion.evidence.observations.map(observation => ({
        ...observation,
        target: { ...observation.target },
        signals: { ...observation.signals },
      })),
      reportProvenance: {
        reportId: input.reportId,
        reportVersionId: input.reportVersionId,
        reportVersionNumber: input.reportVersionNumber,
        reportCreatedAt: input.reportCreatedAt,
        findingKey: checkKey,
        findingTitle: fix.title,
        findingRationale: fix.rationale,
        findingNextStep: fix.nextStep,
        expectedImpact: fix.expectedImpact,
        targetOrigin: targetUrl,
      },
    }]
  })
}
