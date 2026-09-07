import { readScanEvidence, type EvidenceCheckKey, type EvidenceUrl, type ScanEvidence } from '@/lib/scan-evidence'
import { fingerprintEvidence, opportunityKey } from '@/lib/opportunities/fingerprint'
import type {
  PulseSuggestionEvidence,
  SafeObservationEvidence,
  ScanSuggestionEvidence,
  SourceEvidence,
  SourceRef,
  Suggestion,
} from '@/lib/opportunities/types'

const SHA256 = /^[a-f0-9]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizedText(value: string, maximum: number): string | null {
  const normalized = value.normalize('NFC').trim()
  return normalized.length > 0 && Array.from(normalized).length <= maximum ? normalized : null
}

function normalizedNullableTimestamp(value: string | null): string | null {
  if (value === null) return null
  return Number.isFinite(Date.parse(value)) ? value : null
}

function normalizedLimitations(values: readonly string[]): string[] {
  return values.slice(0, 40).flatMap(value => {
    const normalized = normalizedText(value, 160)
    return normalized === null ? [] : [normalized]
  })
}

function safeUrl(value: EvidenceUrl): EvidenceUrl {
  return {
    origin: value.origin,
    pathRedacted: value.pathRedacted,
    queryRedacted: value.queryRedacted,
    fragmentRedacted: value.fragmentRedacted,
    originNormalized: value.originNormalized,
  }
}

function safeObservations(observations: ScanEvidence['observations']): SafeObservationEvidence[] {
  return observations.map(observation => ({
    observedAt: observation.observedAt ?? null,
    provenance: observation.provenance ?? null,
    collection: observation.collection,
    target: safeUrl(observation.target),
    httpStatus: observation.httpStatus ?? null,
    signals: Object.fromEntries(Object.entries(observation.signals ?? {}).map(([key, value]) => [key, value])),
    check: observation.check ?? null,
  }))
}

function pulseSuggestion(source: Extract<SourceEvidence, { kind: 'pulse-metric' }>): Suggestion[] {
  const observation = source.observation
  if (observation.sourceKind !== 'pulse-metric' || !UUID.test(observation.id) || !SHA256.test(source.answerDigest)) return []
  if (observation.result !== 'success' || observation.hasAnswer !== true || observation.brandMentioned !== false) return []
  const question = normalizedText(observation.question, 500)
  const platform = normalizedText(observation.platform, 80)
  if (question === null || platform === null) return []

  const sourceRef: SourceRef = { kind: 'pulse-metric', id: observation.id.toLowerCase() }
  const evidence: PulseSuggestionEvidence = {
    kind: 'pulse-metric',
    id: sourceRef.id,
    promptId: observation.promptId?.toLowerCase() ?? null,
    question,
    platform,
    scanWeek: observation.scanWeek,
    recordedAt: normalizedNullableTimestamp(observation.recordedAt),
    result: 'success',
    hasAnswer: true,
    brandMentioned: false,
    provenance: 'retained-pulse-metric',
    limitations: normalizedLimitations(observation.limitations),
  }
  const ruleVersion = 'pulse-brand-absent.v1' as const
  const titleKey = 'review-question-coverage' as const
  const actionKey = 'review-question-coverage' as const
  const args = { question, platform }
  return [{
    key: opportunityKey(ruleVersion, sourceRef), ruleVersion, source: sourceRef,
    fingerprint: fingerprintEvidence({ ruleVersion, source: sourceRef, evidence: { ...evidence, answerDigest: source.answerDigest }, titleKey, actionKey, args }),
    titleKey, actionKey, args, evidence, limitations: [...evidence.limitations], savedDraftId: null,
  }]
}

function scanSuggestions(source: Extract<SourceEvidence, { kind: 'scan-check' }>): Suggestion[] {
  if (!UUID.test(source.scanId)) return []
  const envelope = readScanEvidence(source.envelope)
  if (envelope === null) return []
  const recordedAt = normalizedNullableTimestamp(source.recordedAt)
  const suggestions: Suggestion[] = []

  for (const checkKey of Object.keys(envelope.checks).sort() as EvidenceCheckKey[]) {
    const check = envelope.checks[checkKey]
    if (check.applicability !== 'applicable' || check.collection !== 'complete' || !['warn', 'fail'].includes(check.assessment)) continue
    const sourceRef: SourceRef = { kind: 'scan-check', id: source.scanId.toLowerCase(), checkKey }
    const evidence: ScanSuggestionEvidence = {
      kind: 'scan-check', scanId: sourceRef.id, recordedAt, checkKey,
      check: {
        applicability: check.applicability,
        version: check.version,
        collection: check.collection,
        assessment: check.assessment,
        ...(check.reason === undefined ? {} : { reason: check.reason }),
      },
      collection: envelope.collection,
      collectedAt: envelope.collectedAt,
      requested: safeUrl(envelope.requested),
      evaluated: safeUrl(envelope.evaluated),
      final: envelope.final === null ? null : safeUrl(envelope.final),
      scannerVersion: envelope.scannerVersion,
      headlineMethod: envelope.headlineMethod,
      pillarMethod: envelope.pillarMethod,
      comparisonSignature: envelope.comparisonSignature,
      comparison: {
        scope: envelope.comparison.scope,
        evaluatedOrigin: envelope.comparison.evaluatedOrigin,
        finalOrigin: envelope.comparison.finalOrigin,
        industry: envelope.comparison.industry,
        region: envelope.comparison.region,
        sitemapSource: envelope.comparison.sitemapSource,
        urlPolicy: envelope.comparison.urlPolicy,
        scannerVersion: envelope.comparison.scannerVersion,
        checkVersions: { ...envelope.comparison.checkVersions },
        headlineMethod: envelope.comparison.headlineMethod,
        pillarMethod: envelope.comparison.pillarMethod,
      },
      observations: safeObservations(envelope.observations),
      limited: envelope.limited,
      limitations: normalizedLimitations(envelope.limitations),
      provenance: 'validated-scan-evidence',
    }
    const ruleVersion = 'scan-check-gap.v1' as const
    const titleKey = 'review-check' as const
    const actionKey = 'review-check' as const
    const args = { checkKey, assessment: check.assessment }
    suggestions.push({
      key: opportunityKey(ruleVersion, sourceRef), ruleVersion, source: sourceRef,
      fingerprint: fingerprintEvidence({ ruleVersion, source: sourceRef, evidence, titleKey, actionKey, args }),
      titleKey, actionKey, args, evidence, limitations: [...evidence.limitations], savedDraftId: null,
    })
  }
  return suggestions
}

export function deriveSuggestions(source: SourceEvidence): Suggestion[] {
  if (source.kind === 'pulse-metric') return pulseSuggestion(source)
  if (source.kind === 'scan-check') return scanSuggestions(source)
  // Stored recommendation eligibility is intentionally deferred pending the paid-access decision.
  return []
}
