import type { OpportunityResponse, ScanSuggestionEvidence } from './types'

export type ScanOpportunity = OpportunityResponse['suggestions'][number] & { evidence: ScanSuggestionEvidence }

export function isEligibleScanOpportunity(item: OpportunityResponse['suggestions'][number], scanId: string): item is ScanOpportunity {
  return item.source.kind === 'scan-check' && item.source.id === scanId &&
    item.evidence.kind === 'scan-check' && item.evidence.scanId === scanId &&
    item.source.checkKey === item.evidence.checkKey &&
    item.evidence.check.collection === 'complete' && item.evidence.check.applicability === 'applicable' &&
    ['fail', 'warn'].includes(item.evidence.check.assessment) && item.saveAvailability === 'available'
}

/** Keep the server's existing priority order and the selected scan's scope. */
export function selectScanOpportunities(data: OpportunityResponse | null, scanId: string): ScanOpportunity[] {
  if (!data || data.window.scanId !== scanId || data.sourceStates.scan !== 'ok') return []
  return data.suggestions.filter((item): item is ScanOpportunity => isEligibleScanOpportunity(item, scanId))
}

export function firstScanOpportunity(data: OpportunityResponse | null, scanId: string): { suggestion: ScanOpportunity | null; unavailable: boolean } {
  return { suggestion: selectScanOpportunities(data, scanId)[0] ?? null,
    unavailable: data === null || data.sourceStates.scan === 'unavailable' || data.window.scanId !== scanId }
}
