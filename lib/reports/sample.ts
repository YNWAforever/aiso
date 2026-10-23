import type { ClientReportSnapshotV1, ReportCheckStatus, ReportLocale } from './types'

/** Public synthetic illustration only. Never use this as a customer report source. */
export const SAMPLE_REPORT = {
  synthetic: true,
  domain: 'example.invalid',
  score: 62,
  grade: 'C',
  observedAt: '2026-09-01T00:00:00.000Z',
  previousScore: 55,
  previousAt: '2026-08-01T00:00:00.000Z',
  trend: [
    { date: '2026-05-01T00:00:00.000Z', score: 41, comparable: true },
    { date: '2026-06-01T00:00:00.000Z', score: 47, comparable: true },
    { date: '2026-07-01T00:00:00.000Z', score: 52, comparable: false },
    { date: '2026-08-01T00:00:00.000Z', score: 55, comparable: true },
    { date: '2026-09-01T00:00:00.000Z', score: 62, comparable: true },
  ],
  checks: {
    c1_robots: 'pass', c2_llms_txt: 'fail', c3_bot_access: 'pass', c4_structured_data: 'warn', c5_extractability: 'fail',
    c6_llms_full_txt: 'unknown', c7_mcp_card: 'fail', c8_sitemap: 'pass', c9_meta_desc: 'pass', c10_headings: 'warn',
    c11_faq: 'fail', c12_canonical: 'pass', c13_render: 'pass', c14_internal_links: 'warn', c15_entity: 'warn', c16_freshness: 'pass',
    c17_citation_density: 'warn', c18_factual_density: 'pass', c19_topical_authority: 'unknown', c20_chunkability: 'pass',
  } satisfies Record<string, ReportCheckStatus>,
  /** Shaped like scan-derived fixes so the report words them from the check catalogue. */
  fixes: [
    { key: 'c5_extractability', reason: 'Resolve failure', impact: 'high' },
    { key: 'c2_llms_txt', reason: 'Resolve failure', impact: 'high' },
    { key: 'c4_structured_data', reason: 'Review warning', impact: 'medium' },
  ],
} as const

/** The sample as a report snapshot; every sentence comes from the locale's sampleReport copy. */
export function sampleReportSnapshot(locale: ReportLocale, copy: { agency: string; brand: string; summary: string; method: string }): ClientReportSnapshotV1 {
  return {
    snapshotSchemaVersion: 1,
    locale,
    branding: { agencyName: copy.agency, logoUrl: null, primaryColor: '#1D4ED8', contactLabel: null, contactUrl: null, attribution: 'Powered by Fimmick AISO' },
    client: { name: copy.brand, domain: SAMPLE_REPORT.domain },
    evidence: { scanDate: SAMPLE_REPORT.observedAt, evidenceTimestamp: SAMPLE_REPORT.observedAt },
    score: {
      current: SAMPLE_REPORT.score, grade: SAMPLE_REPORT.grade, comparisonState: 'comparable',
      previous: SAMPLE_REPORT.previousScore, delta: SAMPLE_REPORT.score - SAMPLE_REPORT.previousScore, previousScanDate: SAMPLE_REPORT.previousAt,
    },
    changes: [
      { key: 'c1_robots', label: 'c1_robots', kind: 'improved' },
      { key: 'c9_meta_desc', label: 'c9_meta_desc', kind: 'improved' },
    ],
    priorityFixes: SAMPLE_REPORT.fixes.map(fix => ({ key: fix.key, title: `${fix.reason}: ${fix.key}`, rationale: '', expectedImpact: fix.impact, nextStep: '' })),
    executiveSummary: copy.summary,
    methodology: copy.method,
    checks: SAMPLE_REPORT.checks,
    trend: SAMPLE_REPORT.trend,
  }
}
