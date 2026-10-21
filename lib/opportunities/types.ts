import type { Observation } from '@/lib/observations/types'
import type { EvidenceCheckKey, EvidenceUrl, ScanEvidence } from '@/lib/scan-evidence'

export type OpportunitySourceKind = 'pulse-metric' | 'scan-check' | 'agent-recommendation'
export type OpportunityLocale = 'en' | 'zh-HK'

export interface SourceRef {
  kind: OpportunitySourceKind
  id: string
  checkKey?: EvidenceCheckKey
}

export type MonitoringContext={runId:string|null;language:string|null;market:string|null}
export interface PulseSourceEvidence {
  monitoringContext?:MonitoringContext
  kind: 'pulse-metric'
  observation: Observation
  /** Server-computed SHA-256 of the exact nullable answer used by the success predicate. */
  answerDigest: string
}

export interface ScanSourceEvidence {
  kind: 'scan-check'
  scanId: string
  recordedAt: string | null
  /** Persisted scans.results.evidence; rules validate it through readScanEvidence. */
  envelope: unknown
}

export interface RecommendationSupportingCheck {
  checkKey: EvidenceCheckKey
  envelope: unknown
}

/** Reserved source shape. Eligibility is deferred until recommendation read/access policy is decided. */
export interface RecommendationSourceEvidence {
  kind: 'agent-recommendation'
  recommendationId: string
  scanId: string
  recordedAt: string | null
  platform: string
  category: string
  priority: 'high' | 'medium' | 'low'
  text: string
  supportingCheck?: RecommendationSupportingCheck
}

export type SourceEvidence = PulseSourceEvidence | ScanSourceEvidence | RecommendationSourceEvidence

export interface PulseSuggestionEvidence {
  kind: 'pulse-metric'
  id: string
  promptId: string | null
  question: string
  platform: string
  scanWeek: string
  recordedAt: string | null
  result: 'success'
  hasAnswer: true
  brandMentioned: false
  provenance: 'retained-pulse-metric'
  limitations: string[]
}

export type SafeCheckEvidence = ScanEvidence['checks'][EvidenceCheckKey]

export interface SafeObservationEvidence {
  observedAt: string | null
  provenance: 'validated-fetch' | null
  collection: ScanEvidence['collection']
  target: EvidenceUrl
  httpStatus: number | null
  signals: Record<string, boolean | number | string>
  check: EvidenceCheckKey | 'page' | 'sitemap' | null
}

export interface ScanSuggestionEvidence {
  kind: 'scan-check'
  scanId: string
  recordedAt: string | null
  checkKey: EvidenceCheckKey
  check: SafeCheckEvidence
  collection: ScanEvidence['collection']
  collectedAt: string | null
  requested: EvidenceUrl
  evaluated: EvidenceUrl
  final: EvidenceUrl | null
  scannerVersion: string
  headlineMethod: string
  pillarMethod: string
  comparisonSignature: string
  comparison: ScanEvidence['comparison']
  observations: SafeObservationEvidence[]
  limited: boolean
  limitations: string[]
  provenance: 'validated-scan-evidence'
}

export type SuggestionEvidence = PulseSuggestionEvidence | ScanSuggestionEvidence

export type PulseSnapshotEvidence = PulseSuggestionEvidence & { answerDigest: string }
export type DraftEvidence = PulseSnapshotEvidence | ScanSuggestionEvidence

export interface Suggestion {
  monitoringContext?:MonitoringContext
  key: string
  ruleVersion: 'pulse-brand-absent.v1' | 'scan-check-gap.v1'
  source: SourceRef
  fingerprint: string
  titleKey: 'review-question-coverage' | 'review-check'
  actionKey: 'review-question-coverage' | 'review-check'
  args: Record<string, string>
  evidence: SuggestionEvidence
  limitations: string[]
  savedDraftId: string | null
}

export interface DraftSnapshotV1 {
  schemaVersion: 1
  source: SourceRef
  ruleVersion: string
  evidence: DraftEvidence
  limitations: string[]
  titleKey: string
  actionKey: string
  args: Record<string, string>
  locale: OpportunityLocale
  initialTitle: string
  initialAction: string
  /** Frozen when the task is created from a saved client-report version. */
  reportProvenance?: ReportFindingProvenance
}

export interface ReportFindingProvenance {
  reportId: string
  reportVersionId: string
  reportVersionNumber: number
  reportCreatedAt: string
  findingKey: EvidenceCheckKey
  findingTitle: string
  findingRationale: string
  findingNextStep: string
  expectedImpact: 'high' | 'medium' | 'low'
  targetOrigin: string | null
}

export type OpportunitySourceState = 'ok' | 'empty' | 'unavailable'
export interface OpportunityWindow {
  pulseWeek: string | null
  pulseLimit: 200
  pulseTruncated: boolean
  scanId: string | null
  nextCursor?:string|null
  asOf?:string
}
export interface OpportunityResponse {
  groups?:OpportunityGroup[]
  schemaVersion: 1
  window: OpportunityWindow
  sourceStates: { pulse: OpportunitySourceState; scan: OpportunitySourceState }
  savedDraftsState: 'ok' | 'unavailable'
  partial: boolean
  suggestions: (Suggestion & { savedState: 'saved' | 'unsaved' | 'unavailable'; saveAvailability: 'available' | 'limited-evidence' })[]
}

export type OpportunityGroup={key:string;promptId:string|null;scopeKey:string;evidenceRefs:SourceRef[];platforms:string[];savedWorkItemId:string|null;suggestionKeys:string[];question:string;context:MonitoringContext|null;latestEvidenceAt:string|null;historicalDraftConflict:boolean}
