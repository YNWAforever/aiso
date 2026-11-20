import { readScanEvidence } from '@/lib/scan-evidence'
import { projectFactualDensityChecks } from '@/lib/factual-density-evidence'
import { CHECK_SLOTS } from '@/lib/result/view-model'

const GEO_KEYS = CHECK_SLOTS.filter(slot => slot.bucket === 'geo').map(slot => `${slot.key}_data`)
const DETAIL_KEYS = [...CHECK_SLOTS.map(slot => slot.key), ...GEO_KEYS, 'c17', 'c18', 'c19', 'c20', 'trust_signals']

export function buildOwnedResultDetails(results: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(DETAIL_KEYS.filter(key => Object.hasOwn(results, key)).map(key => [key, results[key]]))
}

/** Server projection for the already-authorized owner view; not a public DTO. */
export function buildOwnedResultEvidence(value: unknown, results?: Record<string, unknown>) {
  const evidence = readScanEvidence(value)
  if (!evidence) return null
  const checks = projectFactualDensityChecks(evidence.checks, results)
  return {
    collection: evidence.collection === 'complete' && checks !== evidence.checks ? 'partial' as const : evidence.collection,
    completedPages: evidence.completedPages,
    collectedAt: evidence.collectedAt,
    limited: evidence.limited || checks !== evidence.checks,
    scannerVersion: evidence.scannerVersion,
    methodologyVersion: evidence.pillarMethod,
    checks: Object.entries(checks).map(([key, check]) => ({
      key, collection: check.collection, assessment: check.assessment,
    })),
    pillarInputs: Object.fromEntries(Object.entries(checks).map(([key, check]) => [key, {
      collection: check.collection, applicability: check.applicability, assessment: check.assessment,
    }])),
  }
}

export type OwnedResultEvidence = NonNullable<ReturnType<typeof buildOwnedResultEvidence>>
