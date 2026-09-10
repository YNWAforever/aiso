import { describe, expect, it } from 'vitest'
import {
  calculateLocalTrust,
  localTrustRoiScenario,
  resolveSnapshotMonth,
} from '@/lib/localTrust'
import { roiScenario } from '@/lib/localTrust/roi'
import type { LocalTrustBaseline, LocalTrustSnapshotDraft } from '@/lib/localTrust'
import type { Client, LocalTrustProfile, PulseWeeklySummary, Scan } from '@/lib/types'

/**
 * What the enquiry-value figure depends on, now that it depends on anything.
 *
 * The version of this file that this one replaces pinned the opposite property:
 * **the money did not move with the Local Trust Score**. `previousScore` was
 * optional, no caller supplied it, and the fallback baseline was `score - 5` — so
 * the delta was always 5 and the enquiry range was [1, 2] for every score from 1
 * to 100. A client scoring 3 and a client scoring 97 were shown the same amount.
 * Those assertions were written to make removing the fabrication a visible change
 * rather than a silent one, and this is that change.
 *
 * What the figure answers now is a real month-over-month movement. Two things
 * follow, and both are asserted below because both are consequences an owner will
 * meet: a client's first month has nothing to compare against and gets no figure,
 * and a client whose score held still gets no figure either.
 *
 * What has NOT changed is the invention at the centre: nothing in this product
 * measures how many trust points produce an enquiry. The 10-and-4 conversion is
 * an assumption, it is now recorded in `assumptions` and printed to the owner, and
 * the tests here pin that it travels with the number rather than being tuned.
 */

const draft = (score: number) => ({ local_trust_score: score }) as LocalTrustSnapshotDraft

const baseline = (score: number, month = '2026-05-01'): LocalTrustBaseline => ({ score, month })

const scenario = (
  score: number,
  previous: LocalTrustBaseline | null,
  averageLeadValue: unknown = 8000,
  closeRate: unknown = 0.2,
) => roiScenario({
  currentSnapshot: draft(score),
  previous,
  averageLeadValue: averageLeadValue as number,
  closeRate: closeRate as number,
})

describe('the enquiry range moves with the score movement', () => {
  it.each([
    [5, 1, 2],
    [10, 1, 3],
    [20, 2, 5],
    [40, 4, 10],
    [90, 9, 23],
  ])('turns a %i-point rise into %i-%i extra enquiries', (delta, low, high) => {
    const result = scenario(10 + delta, baseline(10))

    expect(result.estimate?.assumptions.estimatedExtraEnquiriesLow).toBe(low)
    expect(result.estimate?.assumptions.estimatedExtraEnquiriesHigh).toBe(high)
  })

  it('separates a nearly-failing client from a nearly-perfect one', () => {
    // The single fact the old file pinned as absent. A 2-point rise and a 92-point
    // rise used to produce identical money.
    const weak = scenario(3, baseline(1))
    const strong = scenario(97, baseline(5))

    expect(weak.estimate!.high).toBeLessThan(strong.estimate!.high)
  })

  it('answers the movement, not the level', () => {
    // Deliberate and worth stating: a client at 20 who gained 10 points and a
    // client at 90 who gained 10 points are shown the same figure. The panel is
    // about what changed this month, and nothing here measures standing.
    const climbing = scenario(20, baseline(10))
    const established = scenario(90, baseline(80))

    expect({ low: climbing.estimate!.low, high: climbing.estimate!.high })
      .toEqual({ low: established.estimate!.low, high: established.estimate!.high })
  })

  it("still moves with the owner's own inputs", () => {
    expect(scenario(50, baseline(40)).estimate).toMatchObject({ low: 1600, high: 4800 })
    expect(scenario(50, baseline(40), 16000).estimate).toMatchObject({ low: 3200, high: 9600 })
    expect(scenario(50, baseline(40), 8000, 0.4).estimate).toMatchObject({ low: 3200, high: 9600 })
  })
})

describe('what it refuses to estimate, and why it says so', () => {
  it('refuses a first month rather than inventing a baseline', () => {
    // This is the behaviour change with a cost, accepted deliberately: every
    // client's first month now shows no figure. The alternative was the fabricated
    // `score - 5`, which showed one to everybody and meant nothing.
    expect(scenario(71, null)).toEqual({ estimate: null, unavailable: 'no_earlier_snapshot' })
  })

  it.each([
    ['held still', 50, 50],
    ['fell', 40, 50],
  ])('refuses a score that %s', (_label, score, previousScore) => {
    expect(scenario(score, baseline(previousScore)))
      .toEqual({ estimate: null, unavailable: 'no_increase' })
  })

  it.each([
    ['no lead value', 0, 0.2],
    ['no close rate', 8000, 0],
    ['a negative lead value', -1, 0.2],
    ['a null lead value', null, 0.2],
    ['an unparseable lead value', 'not a number', 0.2],
  ])('refuses with %s, before it looks at the baseline at all', (_label, leadValue, closeRate) => {
    // Ordering matters for the copy: an owner who has entered nothing should be
    // told to enter it, whether or not they also have an earlier month.
    expect(scenario(50, baseline(10), leadValue, closeRate))
      .toEqual({ estimate: null, unavailable: 'assumptions_missing' })
  })

  it('distinguishes the three refusals, because the panel prints a different sentence for each', () => {
    const reasons = [
      scenario(50, baseline(10), null).unavailable,
      scenario(50, null).unavailable,
      scenario(50, baseline(50)).unavailable,
    ]

    expect(new Set(reasons).size).toBe(3)
  })
})

describe('the estimate carries what it is keyed to', () => {
  it('records the baseline, the movement and the month it compared against', () => {
    // Without these the panel cannot say what changed, and the CSV row travels as
    // a bare amount again — which is the failure the disclosure work fixed once.
    expect(scenario(50, baseline(30, '2026-04-01')).estimate?.assumptions).toEqual({
      averageLeadValue: 8000,
      closeRate: 0.2,
      estimatedExtraEnquiriesLow: 2,
      estimatedExtraEnquiriesHigh: 5,
      previousScore: 30,
      scoreDelta: 20,
      comparedToMonth: '2026-04-01',
      pointsPerEnquiryLow: 10,
      pointsPerEnquiryHigh: 4,
    })
  })

  it('states the unmeasured conversion rather than burying it in the arithmetic', () => {
    // 10 points per enquiry at the low end and 4 at the high end are inventions.
    // Recorded so the owner reads them, and pinned so tuning them is a visible edit.
    const assumptions = scenario(50, baseline(10)).estimate!.assumptions

    expect(assumptions.pointsPerEnquiryLow).toBe(10)
    expect(assumptions.pointsPerEnquiryHigh).toBe(4)
    expect(assumptions.estimatedExtraEnquiriesLow)
      .toBe(Math.round(assumptions.scoreDelta! / assumptions.pointsPerEnquiryLow!))
  })

  it('states a currency and a confidence rather than leaving them implied', () => {
    expect(scenario(50, baseline(10)).estimate)
      .toMatchObject({ currency: 'HKD', confidence: 'directional' })
  })

  it('stores numbers even when the numeric columns arrive as strings', () => {
    // local_trust_profiles.average_lead_value and .close_rate are `numeric`, and
    // lib/db.ts installs no type parser. Stored raw, `assumptions` would carry
    // '8000.00' into the panel and the CSV.
    const assumptions = scenario(50, baseline(40), '8000.00', '0.20').estimate!.assumptions

    expect(assumptions.averageLeadValue).toBe(8000)
    expect(assumptions.closeRate).toBe(0.2)
  })
})

/**
 * The store has to know which month a snapshot will be filed under *before* it can
 * look up the month before it, so the month is resolved by a function the draft
 * also uses. These pin that the two cannot drift apart — a divergence would read
 * as "no earlier snapshot" forever, with nothing failing.
 */
describe('the month used for the lookup is the month the snapshot is filed under', () => {
  const client = { id: 'client-1', industry: 'legal' } as Client
  const profile = { average_lead_value: 8000, close_rate: 0.2 } as LocalTrustProfile
  const scan = { id: 'scan-1', created_at: '2026-06-20T00:00:00.000Z', results: {} } as unknown as Scan
  const pulse = [
    { scan_week: '2026-07-06', platform: null, brand_mentions: 0, top_competitors: {} },
  ] as unknown as PulseWeeklySummary[]

  const input = (over: Partial<Parameters<typeof calculateLocalTrust>[0]> = {}) => ({
    accountId: 'account-1',
    client,
    profile,
    scan,
    pulseSummary: [] as PulseWeeklySummary[],
    missed: [],
    competitors: [],
    previous: null,
    ...over,
  })

  it.each([
    ['a scan alone', {}, '2026-06-01'],
    ['an aggregate Pulse week, which wins', { pulseSummary: pulse }, '2026-07-01'],
    ['neither', { scan: null, pulseSummary: [] }, '1970-01-01'],
  ])('agrees with the draft for %s', (_label, over, expected) => {
    const built = input(over)

    expect(resolveSnapshotMonth(built)).toBe(expected)
    expect(calculateLocalTrust(built).snapshot_month).toBe(expected)
  })

  it('gives the surface the same answer it stored in the column', () => {
    // `roi_estimate` is a column and the reason it is null is not, so the panel
    // asks localTrustRoiScenario. If that disagreed with what was written, the
    // screen would explain an absence that is not there.
    for (const previous of [null, baseline(10), baseline(90)]) {
      const built = input({ previous })
      const computed = calculateLocalTrust(built)

      expect(localTrustRoiScenario(built, computed).estimate).toEqual(computed.roi_estimate)
    }
  })

  it('reports no visibility baseline separately from no earlier month', () => {
    // No scan and no Pulse row is a different absence from "your score did not
    // rise": there is no observed score to compare in the first place.
    const built = input({ scan: null, pulseSummary: [], previous: baseline(10) })

    expect(localTrustRoiScenario(built, calculateLocalTrust(built)))
      .toEqual({ estimate: null, unavailable: 'no_visibility_baseline' })
  })
})
