import { readScanEvidence } from '@/lib/scan-evidence'

/** Server projection for the already-authorized owner view; not a public DTO. */
export function buildOwnedResultEvidence(value: unknown) {
  const evidence = readScanEvidence(value)
  if (!evidence) return null
  return {
    collection: evidence.collection,
    completedPages: evidence.completedPages,
    collectedAt: evidence.collectedAt,
    limited: evidence.limited,
    scannerVersion: evidence.scannerVersion,
    methodologyVersion: evidence.pillarMethod,
    checks: Object.entries(evidence.checks).map(([key, check]) => ({
      key, collection: check.collection, assessment: check.assessment,
    })),
    pillarInputs: Object.fromEntries(Object.entries(evidence.checks).map(([key, check]) => [key, {
      collection: check.collection, applicability: check.applicability, assessment: check.assessment,
    }])),
  }
}

export type OwnedResultEvidence = NonNullable<ReturnType<typeof buildOwnedResultEvidence>>