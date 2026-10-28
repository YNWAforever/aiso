import type { SearchEvidence, Grounding } from '@/lib/pulse/grounding'
import type { ProviderCitation } from '@/lib/pulse/provider-citations'

export const STUDIO_PROMPT_LIMIT = 1000
export type StudioLiveConfig = { platforms: string[]; cap: number }
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
  quota: { cap: number; remaining: number; scope: 'process' }
}
