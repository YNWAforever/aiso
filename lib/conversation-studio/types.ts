import type { ObservationDetailDto } from '@/lib/observations/types'
import type { OwnedResultEvidence } from '@/lib/result-evidence'
import type { OwnerState } from '@/lib/integrations/search-console/state'

export interface StudioInspectorReads {
  documents: { items: { id: string; label: string; versionId: string; versionNumber: number; approvedAt: string; importedAt: string }[]; truncated: boolean } | null
  searchConsole: OwnerState | null
}
export type StudioEvidenceTarget = 'saved' | 'scan' | `source-${number}` | `live-${number}`
export type OpenStudioEvidence = (trigger: HTMLButtonElement, target?: StudioEvidenceTarget) => void

export const STUDIO_TEMPLATES = ['brief', 'competitors', 'pulse', 'report'] as const
export type StudioTemplate = typeof STUDIO_TEMPLATES[number]
export type StudioObservation = Pick<ObservationDetailDto,
  'id' | 'question' | 'platform' | 'scanWeek' | 'recordedAt' | 'collectedAt' | 'model' | 'market' |
  'result' | 'brandMentioned' | 'links' | 'searchEvidence'> & { excerpt: string | null }
export interface StudioEvidence {
  week: string | null
  totalRecorded: number
  truncated: boolean
  observations: StudioObservation[]
  scan: { id: string; recordedAt: string | null; evidence: OwnedResultEvidence } | null
}
export interface StudioReply {
  status: 'evidenced' | 'insufficient'
  template: StudioTemplate | null
  observations: StudioObservation[]
  scan: StudioEvidence['scan']
  researchSteps: ({ kind: 'loadWeek'; week: string; count: number } | { kind: 'selectRecords' | 'composeExtracts' })[]
  coverage: Record<'pulse' | 'citations' | 'scan' | 'live', 'present' | 'missing' | 'unsupported'>
}
