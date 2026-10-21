import {groupOpportunities} from './groups'
import { AuthRateLimitError, authRateLimitResponse } from '@/lib/auth-rate-limit'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'
import 'server-only'
import { getProfile } from '@/lib/auth'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { loadOwnedOpportunitySources, loadSavedDraftMapping } from '@/lib/opportunities/store'
import type { OpportunityResponse } from '@/lib/opportunities/types'
import { parseOpportunityQuery } from './query'

const statuses = { UNAUTHENTICATED:401, INVALID_OPPORTUNITY_QUERY:400, CLIENT_NOT_FOUND:404, OPPORTUNITIES_UNAVAILABLE:503 } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export class OpportunityServiceError extends Error {
  readonly status: number
  constructor(readonly code: keyof typeof statuses) { super(code); this.name = 'OpportunityServiceError'; this.status = statuses[code] }
}
function diagnostic(operation: 'load' | 'sources' | 'saved-drafts') {
  // Deliberately emit no driver message, SQL, identities, or persisted evidence.
  console.error({ event: 'opportunities_unavailable', operation })
}
export async function loadAuthenticatedOpportunities(clientId: string,params=new URLSearchParams()): Promise<OpportunityResponse> {
  try {
    const profile = await getProfile()
    if (!profile) throw new OpportunityServiceError('UNAUTHENTICATED')
    if (!UUID.test(clientId)) throw new OpportunityServiceError('INVALID_OPPORTUNITY_QUERY')
    let query
    try{query=parseOpportunityQuery(params,profile.account_id,clientId)}catch{throw new OpportunityServiceError('INVALID_OPPORTUNITY_QUERY')}
    const snapshot = await loadOwnedOpportunitySources(profile.account_id, clientId,query)
    if (!snapshot) throw new OpportunityServiceError('CLIENT_NOT_FOUND')
    const sourceStates = { pulse: snapshot.sourceStates.pulse, scan: snapshot.sourceStates.scan }
    const partial = Object.values(sourceStates).includes('unavailable')
    if (partial) diagnostic('sources')
    if (Object.values(sourceStates).every(state => state === 'unavailable')) throw new OpportunityServiceError('OPPORTUNITIES_UNAVAILABLE')
    const suggestions = snapshot.sources.filter(source =>
      (source.kind === 'pulse-metric' && sourceStates.pulse === 'ok') || (source.kind === 'scan-check' && sourceStates.scan === 'ok'),
    ).flatMap(source => {
      const recordedAt = source.kind === 'pulse-metric' ? source.observation.recordedAt : source.recordedAt
      return deriveSuggestions(source).map(suggestion => ({ suggestion, recordedAt }))
    }).sort(({ suggestion: a, recordedAt: aDate }, { suggestion: b, recordedAt: bDate }) => {
      const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0
      // Sort by the original six-digit UTC source timestamp. Suggestion evidence
      // intentionally normalizes to milliseconds for its existing fingerprint.
      return compare(a.source.kind, b.source.kind)
        || compare(bDate ?? '', aDate ?? '')
        || compare(a.source.id, b.source.id)
        // Each validated scan's candidates are already ordered by the shared
        // evidence resolver. Stable sort preserves failure-before-warning.
    }).map(({ suggestion }) => suggestion)
    const saveAvailability = new Map<string, 'available' | 'limited-evidence'>()
    for (const source of snapshot.sources) {
      for (const suggestion of deriveSuggestions(source)) {
        try {
          buildInitialDraftSnapshot(suggestion, source, 'en')
          buildInitialDraftSnapshot(suggestion, source, 'zh-HK')
          saveAvailability.set(suggestion.key, 'available')
        } catch { saveAvailability.set(suggestion.key, 'limited-evidence') }
      }
    }
    const limitedEvidence = suggestions.some(item => saveAvailability.get(item.key) !== 'available')
    let savedDraftsState: OpportunityResponse['savedDraftsState'] = 'ok'
    let saved = new Map<string, string>()
    try { saved = await loadSavedDraftMapping(profile.account_id, clientId, suggestions.map(item => item.key)) }
    catch { savedDraftsState = 'unavailable'; diagnostic('saved-drafts') }
    return {
      groups:groupOpportunities(suggestions.map(s=>({...s,savedDraftId:saved.get(s.key)??null}))),
      schemaVersion: 1,
      window: { ...snapshot.window },
      sourceStates, savedDraftsState, partial: partial || limitedEvidence || savedDraftsState === 'unavailable',
      suggestions: suggestions.map(item => ({ ...item, saveAvailability: saveAvailability.get(item.key) ?? 'limited-evidence', savedDraftId: saved.get(item.key) ?? null,
        savedState: savedDraftsState === 'unavailable' ? 'unavailable' : saved.has(item.key) ? 'saved' : 'unsaved' })),
    }
  } catch (error) {
    if (error instanceof OpportunityServiceError || error instanceof AuthRateLimitError) throw error
    diagnostic('load')
    throw new OpportunityServiceError('OPPORTUNITIES_UNAVAILABLE')
  }
}
export function opportunityErrorResponse(error: unknown): Response {
  const limited = authRateLimitResponse(error); if (limited) return limited
  const safe = error instanceof OpportunityServiceError ? error : new OpportunityServiceError('OPPORTUNITIES_UNAVAILABLE')
  return Response.json({ error: safe.code }, { status: safe.status, headers: { 'Cache-Control':'no-store' } })
}
