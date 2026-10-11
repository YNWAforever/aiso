import { readScanEvidence, type ScanEvidence } from '@/lib/scan-evidence'

export type ScanDisplayState = 'scored' | 'failed' | 'limited' | 'unknown'
export function hasFailedScanEvidence(evidence: ScanEvidence | null): boolean {
  return !!evidence && evidence.completedPages === 0 && (['failed', 'blocked'].includes(evidence.collection) || evidence.observations.some(o => o.check === 'page' && (['failed', 'blocked'].includes(o.collection) || (o.httpStatus ?? 0) >= 400)))
}
/** Only validated collection evidence can turn a stored number into a display score. */
export function projectScanStatus(input: { score: number | null; grade: string | null; evidence: unknown }): { state: ScanDisplayState; score: number | null; grade: string | null } {
  const evidence = readScanEvidence(input.evidence)
  if (hasFailedScanEvidence(evidence)) return { state: 'failed', score: null, grade: null }
  if (!evidence || evidence.completedPages !== 1 || input.score === null || !Number.isFinite(input.score)) return { state: 'unknown', score: null, grade: null }
  return { state: evidence.collection === 'complete' && !evidence.limited ? 'scored' : 'limited', score: input.score, grade: input.grade }
}
