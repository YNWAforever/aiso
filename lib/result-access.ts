import { computeImpact } from '@/lib/impact'
import type { Scan } from '@/lib/types'

const ISSUE_PRIORITY = [
  'c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability',
  'c6_llms_full_txt', 'c7_mcp_card', 'c8_sitemap', 'c9_meta_desc', 'c10_headings',
  'c11_faq', 'c12_canonical', 'c13_render', 'c14_internal_links', 'c15_entity', 'c16_freshness',
  'c17_citation_density', 'c18_factual_density', 'c19_topical_authority', 'c20_chunkability',
] as const

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
  const statuses = Object.values(results).filter(
    (value): value is { status: string } => (
      Boolean(value && typeof value === 'object' && 'status' in value)
    ),
  )
  const topIssueKey = ISSUE_PRIORITY.find(key => {
    const value = results[key]
    return Boolean(
      value && typeof value === 'object' && 'status' in value && value.status !== 'pass',
    )
  }) ?? null
  const impact = computeImpact(results, {
    score: scan.score,
    grade: scan.grade ?? 'F',
    industry: scan.industry,
  })

  return {
    id: scan.id,
    domain: scan.domain,
    score: scan.score,
    grade: scan.grade ?? 'F',
    industry: scan.industry ?? null,
    region: scan.region ?? null,
    createdAt: scan.created_at ?? null,
    counts: {
      pass: statuses.filter(value => value.status === 'pass').length,
      warn: statuses.filter(value => value.status === 'warn').length,
      fail: statuses.filter(value => value.status === 'fail').length,
      total: statuses.length,
    },
    topIssueKey,
    teaser: {
      headlineStat: impact.headlineStat,
      projectedScore: impact.projectedScore,
      projectedGrade: impact.projectedGrade,
      platformVisibility: impact.platformVisibility,
    },
  }
}

export type PublicResultSummary = ReturnType<typeof buildPublicResultSummary>
