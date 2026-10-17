import { buildOwnedResultEvidence } from '@/lib/result-evidence'
import { projectScanStatus } from './scan-status'
import { resolveCheckPriorities } from './check-priority'

/** Owner-authorized server projection. UI imports this type only; no Node crypto runs in the browser. */
export function buildScanSummaryView(scan: { id: string; score: number | null; grade?: string | null; results: unknown }) {
  const results = scan.results && typeof scan.results === 'object' && !Array.isArray(scan.results)
    ? scan.results as Record<string, unknown> : {}
  const evidence = buildOwnedResultEvidence(results.evidence, results)
  const display = projectScanStatus({ score: scan.score, grade: scan.grade ?? null, evidence: results.evidence })
  const state = display.state === 'scored' && (evidence?.collection !== 'complete' || evidence.limited)
    ? 'limited' as const : display.state
  return {
    scanId: scan.id, state, score: display.score,
    grade: state === 'scored' ? display.grade : null,
    counts: resolveCheckPriorities(evidence?.pillarInputs ?? {}).counts,
    evidence,
  }
}
export type ScanSummaryView = ReturnType<typeof buildScanSummaryView>
