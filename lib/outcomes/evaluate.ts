import type { EvidenceState, OutcomeComparison, OutcomeInput, OutcomeResponse, OutcomeWindow, SafeEvidence } from './types'
import { OUTCOME_CANDIDATE_LIMIT, OUTCOME_DIAGNOSTIC_LIMIT } from './types'
import { formatUtcMicros, UTC_DAY_MICROS, utcMicros } from './time'

export function sameOutcomeSubject(a: SafeEvidence, b: SafeEvidence): boolean {
  return a.source.kind === b.source.kind && a.source.checkKey === b.source.checkKey
}

// Only a scan check's verdicts are ordered. Pulse answers 'success'/'incomplete',
// which describe whether the observation completed, not whether it went well, so
// ranking them would read a collection state as a result.
const VERDICT_RANK: Record<string, number> = { fail: 0, warn: 1, pass: 2 }

// Reasons that make the two sides describe different work, and reasons that make
// either side untrustworthy. The first refuses outright; the second says we
// cannot yet tell. They are different answers and must not collapse together.
const INADMISSIBLE = ['different-methods-or-scope', 'different-source-subject'] as const
const UNTRUSTWORTHY = ['incomplete-collection', 'source-malformed', 'unknown-evidence', 'collection-time-unknown'] as const

/**
 * The comparison adapter this module had left as a hole.
 *
 * Every path through `evaluateOutcomes` used to end at 'no-comparable-adapter',
 * so an owner who applied a change could never be told whether the finding moved.
 * That was honest, and empty.
 *
 * Admissibility is decided by method, target and configuration — never by
 * content, which is expected to differ between a baseline and a recheck.
 * `partially_comparable` is a real answer rather than a failure: the verdicts
 * moved and are worth showing, but the caller must say the two runs cannot be
 * proven to have landed on the same page. In practice a scan-check baseline is a
 * single frozen check rather than a whole envelope, so it carries
 * 'final-path-identity-withheld' and lands there; a baseline that can prove its
 * target will reach 'comparable' without this policy changing.
 */
export function compareOutcome(baseline: SafeEvidence | null, selected: SafeEvidence | null): OutcomeComparison {
  const baselineVerdict = baseline?.verdict ?? null
  const observedVerdict = selected?.verdict ?? null
  const result = (status: OutcomeComparison['status'], outcome: OutcomeComparison['outcome']): OutcomeComparison =>
    ({ status, outcome, baselineVerdict, observedVerdict })

  if (!baseline) return result('insufficient_evidence', 'cannot_determine')
  if (baseline.source.kind !== 'scan-check') return result('not_comparable', 'cannot_determine')
  // Nothing observed in this window yet is a timing statement, not a verdict.
  if (!selected) return result('insufficient_evidence', 'not_yet_observed')
  if (!sameOutcomeSubject(baseline, selected)) return result('not_comparable', 'cannot_determine')

  const reasons = new Set([...baseline.reasons, ...selected.reasons])
  if (INADMISSIBLE.some(reason => reasons.has(reason))) return result('not_comparable', 'cannot_determine')
  if (UNTRUSTWORTHY.some(reason => reasons.has(reason))) return result('insufficient_evidence', 'cannot_determine')

  const status = reasons.has('final-path-identity-withheld') ? 'partially_comparable' : 'comparable'
  const from = baselineVerdict === null ? undefined : VERDICT_RANK[baselineVerdict]
  const to = observedVerdict === null ? undefined : VERDICT_RANK[observedVerdict]
  if (from === undefined || to === undefined) return result(status, 'cannot_determine')
  return result(status, to > from ? 'improved' : to < from ? 'regressed' : 'unchanged')
}

/** Pure policy: sources must already be account/subject scoped by the owned reader. */
export function evaluateOutcomes(input: OutcomeInput): OutcomeResponse {
  const now = utcMicros(input.evaluatedAt)
  const counts = { 'pulse-metric': 0, 'scan-check': 0 }
  for (const candidate of input.candidates) counts[candidate.source.kind]++
  const truncated = input.truncated || Object.values(counts).some(count => count > OUTCOME_CANDIDATE_LIMIT)
  const diagnostics = input.candidates.filter(candidate => candidate.collectedAt === null || (input.baseline !== null && !sameOutcomeSubject(input.baseline, candidate))).slice(0, OUTCOME_DIAGNOSTIC_LIMIT)
  const response: OutcomeResponse = {
    schemaVersion: 1, policyVersion: 'stored-outcomes.v1', clientId: input.clientId, itemId: input.itemId,
    versionId: input.versionId, contentHash: input.contentHash, evaluatedAt: input.evaluatedAt,
    anchorState: input.anchorState, anchor: input.anchor, baseline: input.baseline,
    windows: [], diagnostics, truncated, reasons: ['point-in-time-read'],
  }
  if (input.sourceState === 'unavailable') response.reasons.push('source-unavailable')
  if (truncated) response.reasons.push('candidate-limit-exceeded')
  if (input.anchorState !== 'active') {
    response.anchor = null
    response.reasons.push(input.anchorState === 'withdrawn' ? 'anchor-withdrawn' : 'no-delivery')
    return response
  }
  if (!input.anchor) throw new TypeError('Active outcome requires an anchor')
  response.reasons.push('self-reported-delivery')
  const delivered = utcMicros(input.anchor.deliveredAt)
  const baselineTime = input.baseline?.collectedAt === null || !input.baseline ? null : utcMicros(input.baseline.collectedAt)
  response.windows = ([7, 28, 56] as const).map(day => {
    const start = delivered + BigInt(day) * UTC_DAY_MICROS, end = start + BigInt(7) * UTC_DAY_MICROS
    const eligible = input.candidates.filter(candidate => {
      if (!input.baseline || !sameOutcomeSubject(input.baseline, candidate) || candidate.collectedAt === null) return false
      const time = utcMicros(candidate.collectedAt)
      return time >= start && time < end && time <= now
    }).sort((a, b) => {
      const left = utcMicros(a.collectedAt!), right = utcMicros(b.collectedAt!)
      return left < right ? -1 : left > right ? 1 : a.source.id < b.source.id ? -1 : a.source.id > b.source.id ? 1 : 0
    })
    const selected = truncated || input.sourceState !== 'ok' ? null : eligible[0] ?? null
    const comparison = compareOutcome(input.baseline, selected)
    let evidenceState: EvidenceState = 'not-comparable'
    const reasons: string[] = []
    if (input.sourceState !== 'ok') { evidenceState = 'unavailable'; reasons.push('source-unavailable') }
    else if (truncated) { evidenceState = 'evidence-limited'; reasons.push('candidate-limit-exceeded') }
    else if (!input.baseline) { evidenceState = 'invalid-baseline'; reasons.push('baseline-missing') }
    else if (baselineTime !== null && baselineTime > delivered) { evidenceState = 'invalid-baseline'; reasons.push('baseline-after-delivery') }
    else if (baselineTime === null || (!selected && diagnostics.some(candidate => candidate.collectedAt === null && sameOutcomeSubject(input.baseline!, candidate)))) { evidenceState = 'timing-unknown'; reasons.push('collection-time-unknown') }
    else if (comparison.status === 'comparable' || comparison.status === 'partially_comparable') evidenceState = 'available'
    // Still no adapter for this subject -- pulse verdicts are collection states,
    // not an ordered result -- so the original reason remains exactly true here.
    else if (comparison.status === 'not_comparable') reasons.push('no-comparable-adapter')
    if (input.baseline?.source.kind === 'pulse-metric') reasons.push('pulse-provenance-incomplete')
    if (selected) reasons.push(...selected.reasons)
    const timeState: OutcomeWindow['timeState'] = selected ? 'observation-available' : now < start ? 'not-due' : now < end ? 'awaiting-evidence' : 'missing-evidence'
    return { day, startsAt: formatUtcMicros(start), endsAt: formatUtcMicros(end), timeState, evidenceState, provisional: selected !== null && now < end, selected, reasons: [...new Set(reasons)], comparison }
  })
  return response
}
