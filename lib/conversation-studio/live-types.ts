import type { SearchEvidence, Grounding } from '@/lib/pulse/grounding'
import type { ProviderCitation } from '@/lib/pulse/provider-citations'

export const STUDIO_PROMPT_LIMIT = 1000
/**
 * Conservative attach budget. A source pack can hold MAX_ENTRIES × MAX_FIELD
 * characters, and every selected platform pays for the attached text in input
 * tokens. 40 entries / 8,000 characters keeps one explicit attachment useful
 * without turning a single Send into an unbounded fan-out cost.
 */
export const STUDIO_ATTACH_MAX_ENTRIES = 40
export const STUDIO_ATTACH_MAX_CHARS = 8_000
/** Metadata-only projection. Source entry bodies never reach the browser list. */
export type StudioAttachCandidate = {
  id: string
  label: string
  versionNumber: number
  contentHash: string
}
export type StudioAttachMeta = {
  sourceId: string
  label: string
  versionId: string
  versionNumber: number
  contentHash: string
  entriesIncluded: number
  entriesTotal: number
  truncated: boolean
  characters: number
}
export type StudioLiveConfig = { platforms: string[]; cap: number }
export type StudioLiveQuota = {
  cap: number
  remaining: number
  scope: 'account' | 'durable'
}
export type StudioLiveAnswer = {
  platform: string
  coverage: 'present' | 'missing' | 'unsupported'
  answer: string | null
  model: string
  startedAt: string
  durationMs: number
  finishReason: string | null
  grounding: Grounding
  searchEvidence: SearchEvidence
  citations: ProviderCitation[]
  error: 'PROVIDER_UNAVAILABLE' | null
}
export type StudioLiveReply = {
  answers: StudioLiveAnswer[]
  quota: StudioLiveQuota
  attachment?: StudioAttachMeta
}
