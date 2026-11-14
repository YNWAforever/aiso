import type { WorkItem } from '@/lib/work-items/schema'
import type { VersionDetail } from '@/lib/change-sets/types'
import type { DeliveryEvent } from '@/lib/delivery/types'
import type { DraftSnapshotV1, OpportunityResponse } from '@/lib/opportunities/types'
import type { OutcomeInput, OutcomeResponse, SafeEvidence } from '@/lib/outcomes/types'
import type { MultiSourceOutcomeInput, MultiSourceOutcomeResponse } from '@/lib/outcomes/multi-source'

/** Controlled sample identities, never authenticated sessions or production grants. */
export type JourneyActor = 'owner' | 'reviewer'
export type JourneyStage = 'draft' | 'pending' | 'approved' | 'delivered'
export type JourneyKind = 'v1-scan' | 'v2-mixed' | 'v2-one-scan'
export type JourneyClockKey = 'early' | 'mature-d7'
export type JourneyObservationProfile = 'stored' | 'unavailable-scan' | 'limited-scan' | 'diagnostic-heavy'
export type JourneyReview = { schemaVersion: 1 } | { schemaVersion: 2; evidenceSnapshots: DraftSnapshotV1[] }
export type JourneyOutcomeReply = OutcomeResponse | MultiSourceOutcomeResponse
export type JourneyOutcomeSnapshot = {
  scope: { accountId: string; clientId: string; itemId: string }
  version: VersionDetail
  decisionRowId: string | null
  events: { event: DeliveryEvent; approvalDecisionId: string | null }[]
  clockKey: JourneyClockKey
  evaluatedAt: string
  observationProfile: JourneyObservationProfile
}
export type JourneyMemoryOptions = {
  freeze?: (draft: WorkItem, versionNumber: number, review: JourneyReview, submittedAt?: string) => VersionDetail
  outcomes?: (snapshot: JourneyOutcomeSnapshot) => JourneyOutcomeReply
}
export type JourneyProjectedKernel = {
  /** Exact full frozen content AND immutable submission metadata, not an ID/hash lookup. */
  versionKey: string
  scope: JourneyOutcomeSnapshot['scope']
  clockKey: JourneyClockKey
  evaluatedAt: string
  observationProfile: JourneyObservationProfile
} & (
  | { schemaVersion: 1; source: Pick<OutcomeInput, 'baseline' | 'candidates' | 'sourceState' | 'truncated'> }
  | { schemaVersion: 2; sources: MultiSourceOutcomeInput['sources'] }
)
export type JourneyScenario = {
  lang: 'en' | 'zh-HK'
  kind: JourneyKind
  brandName: string
  ids: { accountId: string; clientId: string; itemId: string; ownerId: string; reviewerId: string; versionId: string; attestationId: string }
  viewerKeys: Record<JourneyActor, string>
  clock: string
  clocks: Record<JourneyClockKey, string>
  timeline: { submittedAt: string; decidedAt: string; collectedAt: string; sourceRecordedAt: string; observedAt: string; observationRecordedAt: string }
  deliveredAt: string
  review: JourneyReview
  draft: WorkItem
  /** Alternative first submissions, not pre-existing version history. */
  canonicalDrafts: WorkItem[]
  canonicalVersions: VersionDetail[]
  kernels: JourneyProjectedKernel[]
  opportunities: OpportunityResponse
  baseline: SafeEvidence
}
export type JourneyReply = { status: number; body: unknown; headers?: Record<string, string> }
export type JourneyRequest = { actor: JourneyActor; method: string; path: string; body?: unknown }
