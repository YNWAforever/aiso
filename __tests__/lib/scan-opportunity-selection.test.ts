import { expect, it } from 'vitest'
import { firstScanOpportunity, selectScanOpportunities } from '@/lib/opportunities/scan-selection'
import { manyCandidates } from '../components/c9c-fixtures'
const scanId = manyCandidates.window.scanId!

it('keeps the existing server priority order without mutating the source response', () => {
  const original = structuredClone(manyCandidates)
  expect(selectScanOpportunities(manyCandidates, scanId).map(row => row.key)).toEqual(manyCandidates.suggestions.map(row => row.key))
  expect(firstScanOpportunity(manyCandidates, scanId).suggestion?.key).toBe(manyCandidates.suggestions[0].key)
  expect(manyCandidates).toEqual(original)
})
it('rejects unrelated scan windows and unavailable reads', () => {
  expect(firstScanOpportunity(manyCandidates, '99999999-9999-4999-8999-999999999999'))
    .toEqual({ suggestion: null, unavailable: true })
  expect(firstScanOpportunity({ ...manyCandidates, sourceStates: { pulse: 'empty', scan: 'unavailable' } }, scanId))
    .toEqual({ suggestion: null, unavailable: true })
  expect(firstScanOpportunity(null, scanId)).toEqual({ suggestion: null, unavailable: true })
})
it('skips limited, incomplete and mismatched evidence before choosing the first usable finding', () => {
  const [first, second] = manyCandidates.suggestions
  if (first.evidence.kind !== 'scan-check') throw new Error('Scan fixture required')
  const invalid = [
    { ...first, saveAvailability: 'limited-evidence' as const },
    { ...first, source: { ...first.source, id: '99999999-9999-4999-8999-999999999999' } },
    { ...first, evidence: { ...first.evidence, scanId: '99999999-9999-4999-8999-999999999999' } },
    { ...first, evidence: { ...first.evidence, check: { ...first.evidence.check, collection: 'partial' as const } } },
    { ...first, evidence: { ...first.evidence, check: { ...first.evidence.check, assessment: 'pass' as const } } },
  ]
  for (const row of invalid) expect(firstScanOpportunity({ ...manyCandidates, suggestions: [row, second] }, scanId).suggestion?.key).toBe(second.key)
})
