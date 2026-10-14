import { buildScanEvidence, CHECK_VERSIONS, describeEvidenceUrl } from '@/lib/scan-evidence'
import { describe, expect, it } from 'vitest'
import {
  buildClientReportSnapshot,
  replaceExecutiveSummary,
  type ClientReportSnapshotInput,
} from '@/lib/reports/snapshot'

const collectedEvidence=buildScanEvidence({requestedUrl:'https://example.com',evaluatedUrl:'https://example.com',industry:null,region:null,sitemapSource:null,checks:{},observations:[{check:'page',collection:'complete',httpStatus:200,target:{origin:'https://example.com'},provenance:'validated-fetch'}]})
const comparableEvidence = buildScanEvidence({ requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com', industry: 'technology', region: 'global', sitemapSource: 'fetched', checks: Object.fromEntries(Object.keys(CHECK_VERSIONS).map(key => [key, { collection: 'complete', assessment: 'pass' }])), observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: describeEvidenceUrl('https://example.com') }] })
const input: ClientReportSnapshotInput = {
  locale: 'en',
  branding: {
    agencyName: 'Fimmick', logoUrl: 'https://cdn.example/logo.svg', primaryColor: '#123456',
    contactLabel: 'Contact us', contactUrl: 'https://example.com/contact',
  },
  client: { name: 'Example Client', domain: 'www.Example.com' },
  currentScan: {
    accountId: 'account-secret', domain: 'www.Example.com', createdAt: '2026-07-20T12:00:00.000Z',
    score: 72, grade: 'B', results: { evidence:collectedEvidence, c1_robots: { status: 'pass' }, c2_llms_txt: { status: 'warn' } },
  },
  previousScan: null,
  recommendations: [
    { key: 'robots', title: 'Fix robots', rationale: 'Allow AI crawlers.', expectedImpact: 'high', nextStep: 'Update robots.txt' },
    { key: 'robots-copy', title: 'Fix robots', rationale: 'Allow AI crawlers.', expectedImpact: 'medium', nextStep: 'Update robots.txt' },
    { key: 'llms', title: 'Add llms.txt', rationale: 'Make guidance explicit.', expectedImpact: 'high', nextStep: 'Publish llms.txt' },
  ],
}

describe('client report snapshot', () => {
  it('describes a complete root-page baseline without inventing an identity limitation', () => {
    const snapshot = buildClientReportSnapshot({ ...input, currentScan: { ...input.currentScan, results: { evidence: comparableEvidence } } })
    expect(snapshot.methodology).toContain('complete')
    expect(snapshot.methodology).toContain('No earlier scan')
    expect(snapshot.methodology).not.toContain('origin-only identity')
  })
  it('discloses the actual method or scope mismatch for complete root-page evidence', () => {
    const otherScope = buildScanEvidence({ requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com', industry: 'finance', region: 'global', sitemapSource: 'fetched', checks: Object.fromEntries(Object.keys(CHECK_VERSIONS).map(key => [key, { collection: 'complete', assessment: 'pass' }])), observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: describeEvidenceUrl('https://example.com') }] })
    const snapshot = buildClientReportSnapshot({ ...input, currentScan: { ...input.currentScan, results: { evidence: comparableEvidence } }, previousScan: { ...input.currentScan, createdAt: '2026-07-19T12:00:00.000Z', results: { evidence: otherScope } } })
    expect(snapshot.score.comparisonState).toBe('not_comparable')
    expect(snapshot.methodology).toContain('different methods or scope')
    expect(snapshot.methodology).not.toContain('origin-only identity')
  })
  it.each(['en', 'zh-HK'] as const)('does not compare partial origin-only scans or invent regression fixes in %s', locale => {
    const redactedEvidence = buildScanEvidence({ requestedUrl: 'https://example.com/page', evaluatedUrl: 'https://example.com/page', industry: 'technology', region: 'global', sitemapSource: 'fetched', checks: {}, observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: describeEvidenceUrl('https://example.com/page') }] })
    const snapshot = buildClientReportSnapshot({ ...input, locale, recommendations: [], currentScan: { ...input.currentScan, results: { evidence: redactedEvidence } }, previousScan: {
      ...input.currentScan, score: 75, createdAt: '2026-07-19T12:00:00.000Z',
      results: { evidence: redactedEvidence, c1_robots: { status: 'fail' }, c2_llms_txt: { status: 'pass' } },
    } })
    expect(snapshot.score).toEqual({ current: 72, grade: 'B', comparisonState: 'not_comparable' })
    expect(snapshot.changes).toEqual([])
    expect(snapshot.priorityFixes.some(fix => /regression|regressed/i.test(fix.title + fix.rationale))).toBe(false)
    expect(snapshot.executiveSummary).toContain(locale === 'en' ? 'not comparable' : '不具可比性')
    expect(snapshot.methodology).toContain(locale === 'en' ? 'origin-only' : '網站來源')
    expect(snapshot.methodology).toContain(locale === 'en' ? 'partial' : '部分')
  })
  it('uses schema version one and produces deterministic JSON-safe output', () => {
    const first = buildClientReportSnapshot(input)
    const second = buildClientReportSnapshot(input)

    expect(first.snapshotSchemaVersion).toBe(1)
    expect(first).toEqual(second)
  })

  it('omits comparison fields for a baseline and includes only supported evidence in English', () => {
    const snapshot = buildClientReportSnapshot(input)

    expect(snapshot.score).toEqual({ current: 72, grade: 'B', comparisonState: 'baseline' })
    expect(snapshot.executiveSummary).toContain('baseline')
    expect(snapshot.executiveSummary).not.toMatch(/revenue|ranking|traffic|citation|competitor|AI platform/i)
  })

  it('computes a signed score delta and deterministic zh-HK summary for comparable scans', () => {
    const snapshot = buildClientReportSnapshot({
      ...input,
      locale: 'zh-HK',
      currentScan: { ...input.currentScan, results: { evidence: comparableEvidence, c1_robots: { status: 'pass' }, c2_llms_txt: { status: 'warn' } } },
      previousScan: {
        ...input.currentScan,
        createdAt: '2026-07-19T12:00:00.000Z',
        score: 65,
        results: { evidence:comparableEvidence, c1_robots: { status: 'fail' }, c2_llms_txt: { status: 'warn' } },
      },
    })

    expect(snapshot.score).toEqual({
      current: 72, grade: 'B', comparisonState: 'comparable', previous: 65, delta: 7,
      previousScanDate: '2026-07-19T12:00:00.000Z',
    })
    expect(snapshot.executiveSummary).toContain('目前分數')
    expect(snapshot.executiveSummary).not.toMatch(/收入|排名|流量|競爭對手|AI 平台/)
  })

  it('orders fixes ahead of regressions, failures, and warnings; deduplicates equivalent fixes; and caps at five', () => {
    const snapshot = buildClientReportSnapshot({
      ...input,
      currentScan: { ...input.currentScan, results: { evidence:comparableEvidence, c1_robots: { status: 'fail' }, c2_llms_txt: { status: 'warn' } } },
      previousScan: { ...input.currentScan, createdAt: '2026-07-19T12:00:00.000Z', score: 75, results: { evidence:comparableEvidence, c1_robots: { status: 'pass' }, c2_llms_txt: { status: 'pass' } } },
      recommendations: Array.from({ length: 7 }, (_, index) => ({
        key: `fix-${index}`, title: index < 2 ? 'Fix robots' : `Fix ${index}`,
        rationale: index < 2 ? 'Allow AI crawlers.' : `Rationale ${index}`,
        expectedImpact: 'high' as const, nextStep: index < 2 ? 'Update robots.txt' : `Do ${index}`,
      })),
    })

    expect(snapshot.priorityFixes).toHaveLength(5)
    expect(snapshot.priorityFixes.filter(fix => fix.title === 'Fix robots')).toHaveLength(1)
    expect(snapshot.changes.map(change => change.key)).toEqual(['c1_robots', 'c2_llms_txt'])
  })

  it('does not carry account, raw scan, model, prompt, assignee, or HTML fields into the public snapshot', () => {
    const snapshot = buildClientReportSnapshot({
      ...input,
      currentScan: { ...input.currentScan, results: { evidence:collectedEvidence, c1_robots: { status: 'pass', raw: '<b>secret</b>' }, prompt: 'secret', model: 'model', assignee: 'person' } },
    }) as unknown as Record<string, unknown>

    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toMatch(/account-secret|prompt|model|assignee|<b>secret<\/b>/i)
  })


  it('renders truthful zh-HK summary text at runtime', () => {
    const snapshot = buildClientReportSnapshot({ ...input, locale: 'zh-HK' })

    expect(snapshot.executiveSummary).toBe('\u9019\u662f\u76ee\u524d\u5206\u6578 72 \u7684\u57fa\u6e96\u5831\u544a\uff0c\u5df2\u8a18\u9304 0 \u9805\u53ef\u5831\u544a\u6aa2\u67e5\u7d50\u679c\u3002')
  })

  it.each([
    { client: { ...input.client, domain: 'other.example' } },
    { previousScan: { ...input.currentScan, accountId: 'other-account', createdAt: '2026-07-19T12:00:00.000Z' } },
    { previousScan: { ...input.currentScan, domain: 'other.example', createdAt: '2026-07-19T12:00:00.000Z' } },
    { previousScan: { ...input.currentScan, createdAt: '2026-07-20T12:00:00.000Z' } },
    { previousScan: { ...input.currentScan, createdAt: '2026-07-21T12:00:00.000Z' } },
    { currentScan: { ...input.currentScan, createdAt: '2026/07/20' } },
  ])('rejects mismatched account, domain, chronology, and non-ISO scan evidence', overrides => {
    expect(() => buildClientReportSnapshot({ ...input, ...overrides })).toThrow()
  })

  it('deduplicates recommendation, regression, and failure fixes for the same reportable check', () => {
    const snapshot = buildClientReportSnapshot({
      ...input,
      currentScan: { ...input.currentScan, results: { evidence:collectedEvidence, c1_robots: { status: 'fail' } } },
      previousScan: { ...input.currentScan, createdAt: '2026-07-19T12:00:00.000Z', results: { evidence:collectedEvidence, c1_robots: { status: 'pass' } } },
      recommendations: [{ key: 'c1_robots', title: 'Address robots access', rationale: 'The check requires attention.', expectedImpact: 'high', nextStep: 'Update robots access.' }],
    })

    expect(snapshot.priorityFixes.filter(fix => fix.key.includes('c1_robots'))).toHaveLength(1)
  })

  it('allows only a normalized 40-1200 character edited summary', () => {
    const snapshot = buildClientReportSnapshot(input)
    const edited = replaceExecutiveSummary(snapshot, `  ${'Clear evidence-based summary. '.repeat(2)}  `)

    expect(edited.executiveSummary).toBe('Clear evidence-based summary. Clear evidence-based summary.')
    expect(() => replaceExecutiveSummary(snapshot, 'too short')).toThrow()
    expect(() => replaceExecutiveSummary(snapshot, `${'x'.repeat(40)}\u0001`)).toThrow()
    expect(() => replaceExecutiveSummary(snapshot, `${'x'.repeat(40)}\u0080`)).toThrow()
    expect(() => replaceExecutiveSummary(snapshot, `${'x'.repeat(40)}\u009f`)).toThrow()
  })
})

it('UC05 refuses a new scored export over recorded failed collection',()=>{
 const evidence=buildScanEvidence({requestedUrl:'https://example.com',evaluatedUrl:'https://example.com',industry:null,region:null,sitemapSource:'unknown',checks:{},observations:[{check:'page',collection:'failed',httpStatus:503,target:{origin:'https://example.com'}}]})
 expect(()=>buildClientReportSnapshot({...input,currentScan:{...input.currentScan,results:{...input.currentScan.results as Record<string,unknown>,evidence}}})).toThrow(/collection/i)
})

it('new scored exports refuse unknown current and previous collection',()=>{expect(()=>buildClientReportSnapshot({...input,currentScan:{...input.currentScan,results:{c1_robots:{status:'pass'}}}})).toThrow(/Unverified collection/);expect(()=>buildClientReportSnapshot({...input,previousScan:{...input.currentScan,createdAt:'2026-07-19T12:00:00.000Z',results:{c1_robots:{status:'pass'}}}})).toThrow(/Unverified collection/)})
