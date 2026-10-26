import { describe, expect, it } from 'vitest'
import { compareOutcomeCounts, compareOutcomeScores } from '@/lib/outcome-integrations/regression'
describe('bounded deployment regression heuristics', () => {
  it('requires exposure coverage before asserting a conversion regression', () => {
    expect(compareOutcomeCounts({ before: 10, after: 1, beforeSamples: 100, afterSamples: 0 }, 30, 25).state).toBe('insufficient_evidence')
    expect(compareOutcomeCounts({ before: 0, after: 0, beforeSamples: 100, afterSamples: 100 }, 30, 25).state).toBe('insufficient_evidence')
  })
  it('records a relative decline as an association with a heuristic version', () => {
    const result = compareOutcomeCounts({ before: 100, after: 60, beforeSamples: 200, afterSamples: 200 }, 30, 25)
    expect(result).toMatchObject({ state: 'regressed', evidence: { dropPercent: 40, method: 'fimmick-outcome-regression.v1', causation: false } })
  })
  it('requires complete matching score methods and URLs', () => {
    const before = { score: 80, url: 'https://example.com/', signature: 'method', complete: true }
    expect(compareOutcomeScores(before, { ...before, score: 60 }, 10).state).toBe('regressed')
    expect(compareOutcomeScores(before, { ...before, score: 60, signature: 'other' }, 10).state).toBe('not_comparable')
    expect(compareOutcomeScores(before, { ...before, score: 60, complete: false }, 10).state).toBe('not_comparable')
    expect(compareOutcomeScores(before, null, 10).state).toBe('insufficient_evidence')
  })
})
