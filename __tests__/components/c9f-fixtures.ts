import { evaluateOutcomes } from '@/lib/outcomes/evaluate'
import type { OutcomeComparison, OutcomeInput, SafeEvidence } from '@/lib/outcomes/types'
// Pure wire fixtures: browser tests must not import server-only freezeReview.
const clientId = '123e4567-e89b-42d3-a456-426614174004'
const version = { id: '123e4567-e89b-42d3-a456-426614174002', workItemId: '123e4567-e89b-42d3-a456-426614174000', contentHash: '74b05f44e24ae275fef0c11e97324256f886d084204c3b68e5d55cbb916051df' }
const scan: SafeEvidence = { source: { kind: 'scan-check', id: 'baseline-scan', checkKey: 'c1_robots' }, collectedAt: '2026-09-01T00:00:00.123456Z', recordedAt: '2026-09-01T01:00:00Z', verdict: 'fail', reasons: ['final-path-identity-withheld'] }
const pulse: SafeEvidence = { source: { kind: 'pulse-metric', id: 'baseline-pulse', checkKey: null }, collectedAt: null, recordedAt: '2026-09-01T00:00:00Z', verdict: 'success', reasons: ['pulse-provenance-incomplete'] }
export function outcome(overrides: Partial<OutcomeInput> = {}) {
  return evaluateOutcomes({ clientId, itemId: version.workItemId, versionId: version.id, contentHash: version.contentHash,
    evaluatedAt: '2026-09-15T00:00:00Z', anchorState: 'active', anchor: { id: 'attestation-original', deliveredAt: '2026-09-07T00:00:00.123456Z', recordedAt: '2026-09-07T01:00:00Z' }, baseline: scan, candidates: [], sourceState: 'ok', truncated: false, ...overrides })
}
export const outcomes = {
  noDelivery: outcome({ anchorState: 'no-delivery', anchor: null }),
  withdrawn: outcome({ anchorState: 'withdrawn', anchor: null }),
  awaiting: outcome(),
  missing: outcome({ evaluatedAt: '2026-12-01T00:00:00Z' }),
  scan: outcome({ candidates: [{ ...scan, source: { ...scan.source, id: 'selected-scan' }, collectedAt: '2026-09-14T01:00:00Z' }] }),
  pulse: outcome({ baseline: pulse, candidates: [{ ...pulse, source: { ...pulse.source, id: 'retained-pulse' }, recordedAt: '2026-09-14T01:00:00Z' }] }),
  overflow: outcome({ truncated: true }),
  unavailable: outcome({ sourceState: 'unavailable' }),
  deleted: outcome({ baseline: scan, sourceState: 'unavailable' }),
  invalid: outcome({ baseline: null }),
  unsupported: outcome({ baseline: { ...scan, reasons: ['unsupported-source'] }, candidates: [{ ...scan, source: { ...scan.source, id: 'unsupported-scan' }, collectedAt: '2026-09-14T01:00:00Z', reasons: ['unsupported-source'] }] }),
}

const baseline: SafeEvidence = { source: { kind: 'scan-check', id: 'saved-baseline', checkKey: 'c4_structured_data' },
  collectedAt: '2026-09-01T00:00:00.123456Z', recordedAt: '2026-09-01T00:00:00.123456Z', verdict: 'fail', reasons: ['sampled-single-page'] }
const selected: SafeEvidence = { ...baseline, source: { ...baseline.source, id: 'saved-observation' },
  collectedAt: '2026-09-14T01:00:00.123456Z', verdict: 'pass', reasons: ['no-page-or-provider-excerpts'] }
export const smeComparisonCases = [
  { name: 'improvement', baseline, selected, status: 'comparable', change: 'improved' },
  { name: 'unchanged', baseline, selected: { ...selected, verdict: 'fail' }, status: 'comparable', change: 'unchanged' },
  { name: 'regression', baseline: { ...baseline, verdict: 'pass' }, selected: { ...selected, verdict: 'fail' }, status: 'comparable', change: 'regressed' },
  { name: 'partial', baseline: { ...baseline, reasons: ['final-path-identity-withheld'] }, selected, status: 'partially_comparable', change: 'improved' },
  { name: 'different-method', baseline, selected: { ...selected, reasons: ['different-methods-or-scope'] }, status: 'not_comparable', change: 'cannot_determine' },
  { name: 'incomplete', baseline, selected: { ...selected, reasons: ['incomplete-collection'] }, status: 'insufficient_evidence', change: 'cannot_determine' },
  { name: 'not-observed', baseline, selected: null, status: 'insufficient_evidence', change: 'not_yet_observed' },
] satisfies Array<{ name: string; baseline: SafeEvidence; selected: SafeEvidence | null; status: OutcomeComparison['status']; change: OutcomeComparison['outcome'] }>
export const smeOutcomes = Object.fromEntries(smeComparisonCases.map(example => [example.name,
  outcome({ baseline: example.baseline, candidates: example.selected ? [example.selected] : [] })]))
