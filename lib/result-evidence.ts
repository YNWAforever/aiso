import { readScanEvidence } from '@/lib/scan-evidence'
import { projectFactualDensityChecks } from '@/lib/factual-density-evidence'

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
