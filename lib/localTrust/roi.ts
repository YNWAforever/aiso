import type { LocalTrustRoiEstimate } from '@/lib/types'
import type { EstimateRoiInput } from './types'

/**
 * Why a month has no enquiry-value scenario.
 *
 * Before this module required a real baseline, every one of these collapsed into
 * a single null and the panel printed one string for all of them — "Add average
 * lead value and close rate…", which is a lie to an owner who already did. The
 * reason travels with the result so the surface can say the true thing.
 *
 * `no_visibility_baseline` is produced by the caller's own gate rather than here
 * (see `localTrustRoiScenario` in ./scoring): with no scan and no Pulse row there
 * is no score to compare in the first place.
 */
export type RoiUnavailable =
  | 'assumptions_missing'
  | 'no_earlier_snapshot'
  | 'no_increase'
  | 'no_visibility_baseline'

export type RoiScenario =
  | { estimate: LocalTrustRoiEstimate; unavailable: null }
  | { estimate: null; unavailable: RoiUnavailable }

/**
 * Points of Local Trust Score assumed to produce one extra enquiry.
 *
 * **Nothing in this product measures this.** No observation anywhere relates a
 * trust point to an enquiry — every consumer of `local_trust_snapshots` is inside
 * `lib/localTrust`. These two numbers are the invention the whole figure rests on,
 * which is why they are named here and stated to the owner in the panel rather
 * than buried in an expression. Do not tune them into better-looking values: a new
 * constant is the same invention with a more confident face.
 */
const POINTS_PER_ENQUIRY_LOW = 10
const POINTS_PER_ENQUIRY_HIGH = 4

/**
 * The enquiry-value scenario for one month, or the reason there isn't one.
 *
 * `previous` is **required and may be null**, deliberately. It used to be optional
 * with a `?? Math.max(0, score - 5)` fallback, and no caller ever supplied it — so
 * the baseline was always five points below whatever the score happened to be, the
 * delta was always 5, and the enquiry range was [1, 2] for every score from 1 to
 * 100. A client scoring 3 and a client scoring 97 were shown the same amount. A
 * required field means a future caller cannot reintroduce that silently: omitting
 * it is a type error, not a plausible-looking number.
 */
export function roiScenario({
  previous,
  currentSnapshot,
  averageLeadValue,
  closeRate,
}: EstimateRoiInput): RoiScenario {
  // `local_trust_profiles.average_lead_value` and `.close_rate` are `numeric`, and
  // lib/db.ts installs no type parser, so these arrive as strings. Coerced here so
  // what gets stored in `assumptions` is a number regardless of which caller got
  // here first — the panel and the CSV both read those values back.
  const leadValue = Number(averageLeadValue)
  const rate = Number(closeRate)
  if (!Number.isFinite(leadValue) || !Number.isFinite(rate) || leadValue <= 0 || rate <= 0) {
    return { estimate: null, unavailable: 'assumptions_missing' }
  }

  if (!previous) return { estimate: null, unavailable: 'no_earlier_snapshot' }

  const scoreDelta = currentSnapshot.local_trust_score - previous.score
  // A score that fell or held still earns no enquiry-value figure. Reporting one
  // would be the same fabrication in the other direction.
  if (scoreDelta <= 0) return { estimate: null, unavailable: 'no_increase' }

  const estimatedExtraEnquiriesLow = Math.max(1, Math.round(scoreDelta / POINTS_PER_ENQUIRY_LOW))
  const estimatedExtraEnquiriesHigh = Math.max(
    estimatedExtraEnquiriesLow + 1,
    Math.round(scoreDelta / POINTS_PER_ENQUIRY_HIGH),
  )

  return {
    estimate: {
      low: Math.round(estimatedExtraEnquiriesLow * leadValue * rate),
      high: Math.round(estimatedExtraEnquiriesHigh * leadValue * rate),
      currency: 'HKD',
      confidence: 'directional',
      assumptions: {
        averageLeadValue: leadValue,
        closeRate: rate,
        estimatedExtraEnquiriesLow,
        estimatedExtraEnquiriesHigh,
        previousScore: previous.score,
        scoreDelta,
        comparedToMonth: previous.month,
        pointsPerEnquiryLow: POINTS_PER_ENQUIRY_LOW,
        pointsPerEnquiryHigh: POINTS_PER_ENQUIRY_HIGH,
      },
    },
    unavailable: null,
  }
}

/**
 * The stored shape: `local_trust_snapshots.roi_estimate` is the estimate or null.
 * The reason a month has none is not a column — it is derived per request and
 * passed to the surface that has to explain itself.
 */
export function estimateRoi(input: EstimateRoiInput): LocalTrustRoiEstimate | null {
  return roiScenario(input).estimate
}
