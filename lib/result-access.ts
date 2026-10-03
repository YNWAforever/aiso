import { computeImpact } from '@/lib/impact'
import type { Scan } from '@/lib/types'
import { readScanEvidence } from '@/lib/scan-evidence'
import { resolveCheckPriorities } from '@/lib/view-models/check-priority'

export function canViewFullResult(
  scanAccountId?: string | null,
  viewerAccountId?: string | null,
) {
  return Boolean(scanAccountId && viewerAccountId && scanAccountId === viewerAccountId)
}

export function buildPublicResultSummary(
  scan: Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'industry' | 'region' | 'results'>
    & Partial<Pick<Scan, 'account_id' | 'created_at'>> ,
) {
  const results = scan.results as Record<string, { status?: string } | unknown>
  const envelope = readScanEvidence(results.evidence)
  // Legacy verdicts are retained in storage/owner details; they cannot establish
  // a confirmed fix or a success count without collection evidence.
  const resolution = resolveCheckPriorities(envelope?.checks ?? Object.fromEntries(Object.keys(results).map(key => [key, {}])))
  const topIssueKey = resolution.ranked[0]?.checkKey ?? null
  const topIssueStatus = resolution.ranked[0]?.assessment ?? null
  const impact = computeImpact(results, {
    score: scan.score,
    grade: scan.grade ?? 'F',
    industry: scan.industry,
    confirmedChecks: envelope?.checks ?? {},
  })

  return {
    id: scan.id,
    domain: scan.domain,
    score: scan.score,
    grade: scan.grade ?? 'F',
    industry: scan.industry ?? null,
    region: scan.region ?? null,
    createdAt: scan.created_at ?? null,
    counts: resolution.counts,
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
