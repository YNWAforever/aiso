import type { EvidenceState, OutcomeInput, OutcomeResponse, OutcomeWindow, SafeEvidence } from './types'
import { OUTCOME_CANDIDATE_LIMIT, OUTCOME_DIAGNOSTIC_LIMIT } from './types'
import { formatUtcMicros, UTC_DAY_MICROS, utcMicros } from './time'

export function sameOutcomeSubject(a: SafeEvidence, b: SafeEvidence): boolean {
  return a.source.kind === b.source.kind && a.source.checkKey === b.source.checkKey
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
    let evidenceState: EvidenceState = 'not-comparable'
    const reasons: string[] = []
    if (input.sourceState !== 'ok') { evidenceState = 'unavailable'; reasons.push('source-unavailable') }
    else if (truncated) { evidenceState = 'evidence-limited'; reasons.push('candidate-limit-exceeded') }
    else if (!input.baseline) { evidenceState = 'invalid-baseline'; reasons.push('baseline-missing') }
    else if (baselineTime !== null && baselineTime > delivered) { evidenceState = 'invalid-baseline'; reasons.push('baseline-after-delivery') }
    else if (baselineTime === null || (!selected && diagnostics.some(candidate => candidate.collectedAt === null && sameOutcomeSubject(input.baseline!, candidate)))) { evidenceState = 'timing-unknown'; reasons.push('collection-time-unknown') }
    else reasons.push('no-comparable-adapter')
    if (input.baseline?.source.kind === 'pulse-metric') reasons.push('pulse-provenance-incomplete')
    if (selected) reasons.push(...selected.reasons)
    const timeState: OutcomeWindow['timeState'] = selected ? 'observation-available' : now < start ? 'not-due' : now < end ? 'awaiting-evidence' : 'missing-evidence'
    return { day, startsAt: formatUtcMicros(start), endsAt: formatUtcMicros(end), timeState, evidenceState, provisional: selected !== null && now < end, selected, reasons: [...new Set(reasons)] }
  })
  return response
}
