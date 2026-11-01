import { expect, it } from 'vitest'
import { parseCreateDraft } from '@/lib/work-items/schema'
import { buildWorkItemDraftBody, readSavedDraftId, workItemDraftErrorKey } from '@/lib/conversation-studio/work-item-draft'
import { savedStudioOpportunities } from '@/__tests__/helpers/studio-opportunities'

const clientId = '11111111-1111-4111-8111-111111111111'

it.each(['en', 'zh-HK'] as const)('builds the exact work-items create body for %s', locale => {
  for (const suggestion of savedStudioOpportunities.suggestions) {
    const body = buildWorkItemDraftBody(suggestion, locale)
    expect(Object.keys(body).sort()).toEqual(['fingerprint', 'locale', 'ruleVersion', 'source'])
    expect(body).toEqual({
      source: suggestion.source,
      ruleVersion: suggestion.ruleVersion,
      fingerprint: suggestion.fingerprint,
      locale,
    })
    expect(parseCreateDraft(body)).toEqual(body)
  }
})

it('normalizes unknown locales to en instead of inventing a locale', () => {
  const [suggestion] = savedStudioOpportunities.suggestions
  expect(buildWorkItemDraftBody(suggestion, 'fr').locale).toBe('en')
})

it('accepts only the owning client draft id from a create response', () => {
  expect(readSavedDraftId({ item: { id: '55555555-5555-4555-8555-555555555555', clientId } }, clientId)).toBe('55555555-5555-4555-8555-555555555555')
  expect(readSavedDraftId({ item: { id: '55555555-5555-4555-8555-555555555555', clientId: '22222222-2222-4222-8222-222222222222' } }, clientId)).toBeNull()
  expect(readSavedDraftId({ item: { id: 42, clientId } }, clientId)).toBeNull()
  expect(readSavedDraftId(null, clientId)).toBeNull()
})

it.each([
  [401, undefined, 'workItemDraftUnauthenticated'],
  [404, 'CLIENT_NOT_FOUND', 'workItemDraftNotFound'],
  [400, 'INVALID_WORK_ITEM_INPUT', 'workItemDraftInvalid'],
  [409, 'EVIDENCE_CHANGED', 'workItemDraftEvidenceChanged'],
  [409, 'WORK_ITEM_CONFLICT', 'workItemDraftError'],
  [503, 'WORK_ITEMS_UNAVAILABLE', 'workItemDraftUnavailable'],
  [500, undefined, 'workItemDraftError'],
] as const)('maps status %s (%s) to honest copy %s', (status, code, key) => {
  expect(workItemDraftErrorKey(status, code)).toBe(key)
})
