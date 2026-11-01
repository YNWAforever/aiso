import type { StudioOpportunitySuggestion } from './types'

export interface WorkItemDraftBody {
  source: StudioOpportunitySuggestion['source']
  ruleVersion: StudioOpportunitySuggestion['ruleVersion']
  fingerprint: string
  locale: 'en' | 'zh-HK'
}

/** Mirrors the OpportunityWorkspace create contract exactly. */
export function buildWorkItemDraftBody(
  suggestion: StudioOpportunitySuggestion,
  locale: string,
): WorkItemDraftBody {
  return {
    source: suggestion.source,
    ruleVersion: suggestion.ruleVersion,
    fingerprint: suggestion.fingerprint,
    locale: locale === 'zh-HK' ? 'zh-HK' : 'en',
  }
}

export function readSavedDraftId(data: unknown, clientId: string): string | null {
  const item = (data as { item?: { id?: unknown; clientId?: unknown } } | null)?.item
  return item && typeof item.id === 'string' && item.clientId === clientId ? item.id : null
}

export function workItemDraftErrorKey(status: number, code?: unknown): string {
  if (status === 401) return 'workItemDraftUnauthenticated'
  if (status === 404) return 'workItemDraftNotFound'
  if (status === 400) return 'workItemDraftInvalid'
  if (status === 409) return code === 'EVIDENCE_CHANGED' ? 'workItemDraftEvidenceChanged' : 'workItemDraftError'
  if (status === 503) return 'workItemDraftUnavailable'
  return 'workItemDraftError'
}
