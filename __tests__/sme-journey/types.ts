import type { WorkItem } from '@/lib/work-items/schema'
import type { VersionDetail } from '@/lib/change-sets/types'
import type { OpportunityResponse } from '@/lib/opportunities/types'
import type { SafeEvidence } from '@/lib/outcomes/types'

/** Controlled sample identities, never authenticated sessions or production grants. */
export type JourneyActor = 'owner' | 'reviewer'
export type JourneyStage = 'draft' | 'pending' | 'approved' | 'delivered'
export type JourneyScenario = {
  lang: 'en' | 'zh-HK'
  brandName: string
  ids: { clientId: string; itemId: string; ownerId: string; reviewerId: string; versionId: string; attestationId: string }
  clock: string
  deliveredAt: string
  draft: WorkItem
  /** Finite exact saved states frozen in Node for the standalone sample. */
  canonicalDrafts: WorkItem[]
  canonicalVersions: VersionDetail[]
  opportunities: OpportunityResponse
  baseline: SafeEvidence
}
export type JourneyReply = { status: number; body: unknown; headers?: Record<string, string> }
export type JourneyRequest = { actor: JourneyActor; method: string; path: string; body?: unknown }
