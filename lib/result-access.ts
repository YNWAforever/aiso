import { computeImpact } from '@/lib/impact'
import type { Scan } from '@/lib/types'
import { hasFailedScanEvidence, projectScanStatus } from '@/lib/view-models/scan-status'
import { readScanEvidence } from '@/lib/scan-evidence'
import { resolveCheckPriorities } from '@/lib/view-models/check-priority'
import { projectFactualDensityChecks } from '@/lib/factual-density-evidence'

export function canViewFullResult(
  scanAccountId?: string | null,
  viewerAccountId?: string | null,
) {
  return Boolean(scanAccountId && viewerAccountId && scanAccountId === viewerAccountId)
}

/** A recorded collection failure is not a poor website score. Legacy unknown remains unknown. */
export function hasFailedScanPage(results: Record<string, unknown>): boolean {
  const evidence=readScanEvidence(results.evidence)
  return hasFailedScanEvidence(evidence)
}

export function buildPublicResultSummary(
  scan: Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'industry' | 'region' | 'results'>
    & Partial<Pick<Scan, 'account_id' | 'created_at'>> ,
) {
  const results = scan.results as Record<string, { status?: string } | unknown>
  const envelope = readScanEvidence(results.evidence)
  const display = projectScanStatus({ score: scan.score, grade: scan.grade ?? null, evidence: results.evidence })
  const checks = projectFactualDensityChecks(envelope?.checks ?? Object.fromEntries(Object.keys(results).map(key => [key, {}])), results)
  // Legacy verdicts are retained in storage/owner details; they cannot establish
  // a confirmed fix or a success count without collection evidence.
  const resolution = resolveCheckPriorities(checks)
  const topIssueKey = resolution.ranked[0]?.checkKey ?? null
  const topIssueStatus = resolution.ranked[0]?.assessment ?? null
  const impact = computeImpact(results, {
    score: scan.score,
    grade: scan.grade ?? 'F',
    industry: scan.industry,
    confirmedChecks: checks,
  })

  return {
    id: scan.id,
    domain: scan.domain,
    collectionFailed: display.state === 'failed',
    score: display.score,
    grade: display.grade,
    industry: scan.industry ?? null,
    region: scan.region ?? null,
    createdAt: scan.created_at ?? null,
    counts: resolution.counts,
    // Verdicts only (pass / warn / fail / unknown / not-applicable): what the
    // heatmap and gauges draw. Messages, details and remediation stay owner-only.
    checks: resolution.assessments,
    priorityState: resolution.state,
    topIssueKey,
    topIssueStatus,
    teaser: {
      headlineStat: impact.headlineStat,
      projectedScore: impact.projectedScore,
      projectedGrade: impact.projectedGrade,
      platformVisibility: impact.platformVisibility,
      collectorAccess: impact.collectorAccess,
      benchmark: impact.benchmark,
    },
  }
}

export type PublicResultSummary = ReturnType<typeof buildPublicResultSummary>
