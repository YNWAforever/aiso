import { evaluateOutcomes } from '@/lib/outcomes/evaluate'
import type { OutcomeInput, SafeEvidence } from '@/lib/outcomes/types'
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
