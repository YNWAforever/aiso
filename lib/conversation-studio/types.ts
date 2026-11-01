import type { ObservationDetailDto } from '@/lib/observations/types'
import type { OwnedResultEvidence } from '@/lib/result-evidence'
import type { OwnerState } from '@/lib/integrations/search-console/state'

export interface StudioInspectorReads {
  documents: { items: { id: string; label: string; versionId: string; versionNumber: number; approvedAt: string; importedAt: string }[]; truncated: boolean } | null
  searchConsole: OwnerState | null
}
export type StudioEvidenceTarget = 'saved' | 'scan' | `source-${number}` | `live-${number}`
export type OpenStudioEvidence = (trigger: HTMLButtonElement, target?: StudioEvidenceTarget) => void

export const STUDIO_TEMPLATES = ['brief', 'competitors', 'pulse', 'report', 'opportunity'] as const
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
export interface StudioOpportunityEvidenceRef {
  kind: 'pulse-metric' | 'scan-check'
  id: string
  checkKey?: string
}
export interface StudioOpportunitySuggestion {
  key: string
  title: string
  action: string
  recordedAt: string | null
  evidenceRefs: StudioOpportunityEvidenceRef[]
  source: StudioOpportunityEvidenceRef
  ruleVersion: 'pulse-brand-absent.v1' | 'scan-check-gap.v1'
  fingerprint: string
  savedDraftId: string | null
  savedState: 'saved' | 'unsaved' | 'unavailable'
  saveAvailability: 'available' | 'limited-evidence'
}
export interface StudioOpportunities {
  state: 'ready' | 'empty' | 'pending'
  suggestions: StudioOpportunitySuggestion[]
  partial: boolean
  pulseWeek: string | null
  sourceStates: { pulse: 'ok' | 'empty' | 'unavailable'; scan: 'ok' | 'empty' | 'unavailable' }
}
export interface StudioReply {
  status: 'evidenced' | 'insufficient'
  template: StudioTemplate | null
  observations: StudioObservation[]
  scan: StudioEvidence['scan']
  opportunities?: StudioOpportunities
  researchSteps: ({ kind: 'loadWeek'; week: string; count: number } | { kind: 'loadOpportunities'; count: number } | { kind: 'selectRecords' | 'composeExtracts' })[]
  coverage: Record<'pulse' | 'citations' | 'scan' | 'live', 'present' | 'missing' | 'unsupported'>
}
