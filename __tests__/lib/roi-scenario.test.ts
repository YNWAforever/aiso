import { describe, expect, it } from 'vitest'
import { estimateRoi } from '@/lib/localTrust/roi'
import type { LocalTrustSnapshot } from '@/lib/types'

/**
 * What the enquiry-value figure actually depends on.
 *
 * This pins the property that made the old "ROI Proof Timeline" heading a false
 * claim: **the money does not move with the Local Trust Score**. No caller
 * supplies `previousScore`, so the fallback baseline is always `score - 5`, the
 * delta is always capped at 5, and the enquiry range is `[1, 2]` for every
 * non-zero score from 1 to 100. A client scoring 3 and a client scoring 97 are
 * shown the identical number.
 *
 * The arithmetic is not wrong — one to two extra enquiries at the owner's own
 * stated lead value and close rate is exactly what it computes. The framing was
 * wrong: a heading claiming proof, directly beneath a score the figure cannot
 * respond to.
 *
 * These tests assert the behaviour as it is, deliberately, rather than what it
 * should ideally be. Supplying a real `previousScore` is a separate change with a
 * real consequence — every client's first month would then correctly show no
 * estimate — and it must not be smuggled in behind a copy fix. If that lands,
 * these are the tests that must be rewritten, which is the point of them.
 */

const snapshot = (score: number) => ({ local_trust_score: score }) as LocalTrustSnapshot

const estimate = (score: number, averageLeadValue = 8000, closeRate = 0.2) =>
  estimateRoi({ currentSnapshot: snapshot(score), averageLeadValue, closeRate })

describe('the enquiry range does not depend on the score', () => {
  it.each([1, 3, 5, 10, 42, 71, 100])('gives 1-2 extra enquiries at a score of %i', score => {
    const result = estimate(score)

    expect(result?.assumptions.estimatedExtraEnquiriesLow).toBe(1)
    expect(result?.assumptions.estimatedExtraEnquiriesHigh).toBe(2)
  })

  it('produces the same money for a nearly-failing and a nearly-perfect client', () => {
    // The single fact that makes "proof" the wrong word.
    const weak = estimate(3)
    const strong = estimate(97)

    expect({ low: weak?.low, high: weak?.high }).toEqual({ low: strong?.low, high: strong?.high })
  })

  it("is the owner's own arithmetic, and moves only when their inputs move", () => {
    expect(estimate(50, 8000, 0.2)).toMatchObject({ low: 1600, high: 3200 })
    expect(estimate(50, 16000, 0.2)).toMatchObject({ low: 3200, high: 6400 })
    expect(estimate(50, 8000, 0.4)).toMatchObject({ low: 3200, high: 6400 })
  })
})

describe('what it refuses to estimate', () => {
  it('declines at a zero score rather than inventing a floor', () => {
    // baseline is max(0, 0 - 5) = 0, so the delta is 0 and there is nothing to
    // scale. The absence of a number is the honest output here.
    expect(estimate(0)).toBeNull()
  })

  it.each([
    ['no lead value', 0, 0.2],
    ['no close rate', 8000, 0],
    ['a negative lead value', -1, 0.2],
  ])('declines with %s', (_label, leadValue, closeRate) => {
    expect(estimate(50, leadValue, closeRate)).toBeNull()
  })
})

describe('the estimate carries its own basis', () => {
  it('records the inputs it used, so the figure can be explained where it is shown', () => {
    // The panel and the CSV both render these. Without them the number travels
    // as a bare amount, which is what made the export the riskiest surface.
    expect(estimate(50)?.assumptions).toEqual({
      averageLeadValue: 8000,
      closeRate: 0.2,
      estimatedExtraEnquiriesLow: 1,
      estimatedExtraEnquiriesHigh: 2,
    })
  })

  it('states a currency and a confidence rather than leaving them implied', () => {
    expect(estimate(50)).toMatchObject({ currency: 'HKD', confidence: 'directional' })
  })

  it('honours a real previous score when one is ever supplied', () => {
    // Nothing passes this today. Asserted so that wiring a real baseline becomes
    // a visible behaviour change rather than a silent one: a 40-point rise gives
    // a materially different range from the fabricated 5.
    const withBaseline = estimateRoi({
      currentSnapshot: snapshot(50), previousScore: 10, averageLeadValue: 8000, closeRate: 0.2,
    })

    expect(withBaseline?.assumptions.estimatedExtraEnquiriesLow).toBe(4)
    expect(withBaseline?.assumptions.estimatedExtraEnquiriesHigh).toBe(10)
  })
})
