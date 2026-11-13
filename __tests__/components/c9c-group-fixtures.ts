import type { OpportunityResponse, OpportunityGroup } from '@/lib/opportunities/types'
import { initial, scanSuggestion } from './c9c-fixtures'
const context = { runId: '77777777-7777-4777-8777-777777777777', language: 'en', market: 'HK' }
const evidence = initial.suggestions[0].evidence
if (evidence.kind !== 'pulse-metric') throw new Error('Expected Pulse fixture')
const suggestions: OpportunityResponse['suggestions'] = Array.from({ length: 4 }, (_, index) => {
  const id = `33333333-3333-4333-8333-33333333333${index}`
  const question = index < 2 ? 'First retained question' : 'Second retained question'
  const platform = index % 2 === 0 ? 'ChatGPT' : 'Gemini'
  return { ...initial.suggestions[0], key: `group-source-${index}`, source: { kind: 'pulse-metric', id }, monitoringContext: context,
    evidence: { ...evidence, id, question, platform, recordedAt: '2026-09-03T10:00:00Z' }, args: { question, platform }, savedState: 'unsaved' }
})
const groups: OpportunityGroup[] = [0, 1].map(index => {
  const sources = suggestions.slice(index * 2, index * 2 + 2)
  return { key: `group.v1:${(index === 0 ? 'a' : 'b').repeat(64)}`, promptId: null, scopeKey: `fixture-known-scope-${index}`, evidenceRefs: sources.map(row => row.source),
    platforms: ['ChatGPT', 'Gemini'], savedWorkItemId: null, suggestionKeys: sources.map(row => row.key), question: String(sources[0].args.question), context,
    latestEvidenceAt: '2026-09-03T10:00:00Z', historicalDraftConflict: false }
})
export const groupedCandidates: OpportunityResponse = { ...initial, groups, suggestions: [...suggestions, scanSuggestion] }
export const groupedConflict: OpportunityResponse = { ...groupedCandidates, groups: groups.map((group, index) => ({ ...group, historicalDraftConflict: index === 0 })) }
export const blockedCandidates: OpportunityResponse = { ...initial, suggestions: [{ ...initial.suggestions[0], saveAvailability: 'limited-evidence' }, scanSuggestion] }
