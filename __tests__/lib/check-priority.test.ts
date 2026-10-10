import { describe, expect, it } from 'vitest'
import { buildScanEvidence, CHECK_VERSIONS, type EvidenceCheckKey } from '@/lib/scan-evidence'
import { buildPublicResultSummary } from '@/lib/result-access'
import { buildOwnerPriorities } from '@/lib/view-models/owner-priorities'
import { resolveCheckPriorities } from '@/lib/view-models/check-priority'
import { computeImpact } from '@/lib/impact'
export function priorityFixture(overrides: Partial<Record<EvidenceCheckKey, { assessment: string; collection: string }>> = {}, fallback = { assessment: 'pass', collection: 'complete' }) {
  const checks = Object.fromEntries(Object.keys(CHECK_VERSIONS).map(key => [key, overrides[key as EvidenceCheckKey] ?? fallback]))
  const evidence = buildScanEvidence({ requestedUrl: 'https://synthetic.test', evaluatedUrl: 'https://synthetic.test', industry: 'technology', region: 'HK', sitemapSource: 'fetched', checks })
  const results = Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, { status: value.assessment, message: 'synthetic', details: 'PRIVATE_SENTINEL' }]))
  return { id: 'synthetic', domain: 'synthetic.test', score: 50, grade: 'D', industry: 'technology', region: 'HK', results: { ...results, evidence } }
}
describe('T03 shared public and owner priorities', () => {
  it('confirmed_failure_precedes_warning for R04 c6 warn and c8 fail', () => {
    const scan = priorityFixture({ c6_llms_full_txt: { assessment: 'warn', collection: 'complete' }, c8_sitemap: { assessment: 'fail', collection: 'complete' } })
    expect(buildPublicResultSummary(scan as never).topIssueKey).toBe('c8_sitemap')
    expect(buildOwnerPriorities(scan.results.evidence).primaryAction?.checkKey).toBe('c8_sitemap')
  })
  it('severity precedes points at stake on the owner surface too', () => {
    const scan = priorityFixture({ c1_robots: { assessment: 'warn', collection: 'complete' }, c8_sitemap: { assessment: 'fail', collection: 'complete' } })
    expect(buildOwnerPriorities(scan.results.evidence).primaryAction?.checkKey).toBe('c8_sitemap')
  })
  it('incomplete_check_is_retry_not_fix even if its raw verdict is fail', () => {
    const scan = priorityFixture({ c1_robots: { assessment: 'fail', collection: 'failed' }, c6_llms_full_txt: { assessment: 'warn', collection: 'complete' } })
    expect(buildPublicResultSummary(scan as never).topIssueKey).toBe('c6_llms_full_txt')
    expect(buildOwnerPriorities(scan.results.evidence).needsEvidence).toContainEqual({ checkKey: 'c1_robots', collection: 'failed' })
  })
  it('all unknown and historical verdict-only results never become confirmed fixes', () => {
    const scan = priorityFixture({}, { assessment: 'fail', collection: 'unknown' })
    expect(buildPublicResultSummary(scan as never).topIssueKey).toBeNull()
    const { evidence: _envelope, ...legacy } = scan.results
    expect(buildPublicResultSummary({ ...scan, results: legacy } as never).topIssueKey).toBeNull()
  })
  it('does not expose original evidence or paid remediation while ranking', () => {
    const scan = priorityFixture({ c8_sitemap: { assessment: 'fail', collection: 'complete' } })
    const summary = buildPublicResultSummary(scan as never)
    expect(JSON.stringify(summary)).not.toContain('PRIVATE_SENTINEL')
    expect(summary).not.toHaveProperty('results')
    expect(summary).not.toHaveProperty('evidence')
  })
  it('excludes unknown verdicts from confirmed counts and all secondary quick wins', () => {
    const scan = priorityFixture({}, { assessment: 'fail', collection: 'unknown' })
    const summary = buildPublicResultSummary(scan as never)
    expect(summary.counts).toMatchObject({ fail: 0, warn: 0, pass: 0, unknown: 20 })
    expect(summary.priorityState).toBe('insufficient-evidence')
    const impact = computeImpact(scan.results, { score: 50, confirmedChecks: scan.results.evidence.checks })
    expect(impact.quickWins).toEqual([])
    expect(impact.headlineStat.type).toBe('evidence_needed')
    expect(impact.projectedScore).toBe(50)
  })
  it('uses the same order for impact and owner when a high-weight warning competes with a failure', () => {
    const scan = priorityFixture({ c1_robots: { assessment: 'warn', collection: 'complete' }, c8_sitemap: { assessment: 'fail', collection: 'complete' } })
    expect(computeImpact(scan.results, { score: 50, confirmedChecks: scan.results.evidence.checks }).quickWins.map(w => w.key)).toEqual(['c8_sitemap', 'c1_robots'])
  })
  it('has stable ties and explicit pass and not-applicable states', () => {
    const input = { collection: 'complete', applicability: 'applicable', assessment: 'fail' }
    expect(resolveCheckPriorities({ c11_faq: input, c10_headings: input }).ranked.map(c => c.checkKey)).toEqual(['c10_headings', 'c11_faq'])
    expect(resolveCheckPriorities({ c11_faq: { ...input, assessment: 'pass' } }).state).toBe('all-clear')
    expect(resolveCheckPriorities({ c11_faq: { ...input, assessment: 'not-applicable', applicability: 'not-applicable' } }).state).toBe('not-applicable')
  })
})
