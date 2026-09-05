import { describe, it, expect } from 'vitest'
import { buildScanEvidence, readScanEvidence, compareScanEvidence, CHECK_VERSIONS, describeEvidenceUrl } from '@/lib/scan-evidence'

const input = () => ({ requestedUrl: 'https://example.com/private-secret?q=secret#secret', evaluatedUrl: 'https://example.com', industry: 'general_b2c', region: 'global', sitemapSource: 'fetched' as const, checks: {} })
describe('bounded scan evidence', () => {
  it('retains all identities without inventing historical collection or leaking input', () => {
    const evidence = buildScanEvidence(input())
    expect(Object.keys(evidence.checks)).toEqual(Object.keys(CHECK_VERSIONS))
    expect(evidence.checks.c1_robots.collection).toBe('unknown')
    expect(evidence.collection).toBe('unknown')
    expect(evidence.completedPages).toBe(0)
    expect(evidence.completedScope).toBe('none')
    expect(evidence.checks.c1_robots.applicability).toBe('not-verifiable')
    expect(evidence).not.toHaveProperty('status')
    expect(JSON.stringify(evidence)).not.toMatch(/private-secret|q=secret|#secret/)
    expect(evidence.requested.pathRedacted).toBe(true)
    expect(readScanEvidence(evidence)).toEqual(evidence)
    const reversed = Object.fromEntries(Object.entries(evidence).reverse())
    expect(readScanEvidence(reversed)).toEqual(evidence)
    expect(readScanEvidence({ schemaVersion: 1 })).toBeNull()
    expect(readScanEvidence(undefined)).toBeNull()
    expect(compareScanEvidence(evidence, evidence).comparable).toBe(false)
  })
  it('separates a genuine negative assessment from failed collection', () => {
    const evidence = buildScanEvidence({ ...input(), checks: {
      c1_robots: { assessment: 'fail', collection: 'complete' },
      c2_llms_txt: { assessment: 'fail', collection: 'failed' },
      c3_bot_access: { assessment: 'not-applicable', collection: 'unsupported' },
    } })
    expect(evidence.checks.c1_robots.collection).toBe('complete')
    expect(evidence.checks.c2_llms_txt.collection).toBe('failed')
    expect(evidence.checks.c3_bot_access.assessment).toBe('not-applicable')
    expect(evidence.checks.c3_bot_access.applicability).toBe('not-applicable')
  })
  it('limits adversarial observations deterministically and rejects corrupt history', () => {
    const evidence = buildScanEvidence({ ...input(), observations: Array.from({length: 100}, () => ({
      collection: 'complete', target: describeEvidenceUrl('https://example.com/secret'),
      signals: { contentLength: 500, mimeType: 'text/html', secret: '秘密'.repeat(10000) },
    })) })
    expect(evidence.observations.length).toBeLessThanOrEqual(40)
    expect(evidence.limited).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(evidence))).toBeLessThanOrEqual(32768)
    for (const record of Object.values(evidence.checks)) expect(Buffer.byteLength(JSON.stringify(record))).toBeLessThanOrEqual(1024)
    expect(JSON.stringify(evidence)).not.toContain('秘密')
    expect(readScanEvidence({...evidence, unexpected: 'secret'})).toBeNull()
  })
  it('records completed scope and stable method identity without allowing redacted comparisons', () => {
    const checks = Object.fromEntries(Object.keys(CHECK_VERSIONS).map(key => [key, {collection:'complete', assessment:'pass'}]))
    const observations = [{collection:'complete',check:'page',httpStatus:200,target:describeEvidenceUrl('https://example.com/'), observedAt:'2026-09-05T00:00:00.000Z'}]
    const first = buildScanEvidence({...input(),checks,observations,collectedAt:'2026-09-05T00:00:00.000Z'})
    const second = buildScanEvidence({...input(),checks,observations,collectedAt:'2026-09-06T00:00:00.000Z'})
    expect(first.completedPages).toBe(1)
    expect(first.completedScope).toBe('single-origin-page')
    expect(first.collection).toBe('complete')
    expect(first.comparisonSignature).toBe(second.comparisonSignature)
    expect(compareScanEvidence(first,second)).toEqual({comparable:false,reason:'final-path-identity-withheld'})
    const otherRegion = buildScanEvidence({...input(),checks,observations,region:'HK'})
    expect(compareScanEvidence(first,otherRegion).reason).toBe('different-methods-or-scope')
    expect(readScanEvidence({...first, scannerVersion:'old'})).toBeNull()
  })

  it.each(['UNTRUSTED_SENTINEL', 'x'.repeat(40000), { private: 'UNTRUSTED_SENTINEL' }, null])('bounds runtime-untrusted sitemap provenance', value => {
    const evidence = buildScanEvidence({ ...input(), sitemapSource: value as never })
    expect(evidence.comparison.sitemapSource).toBe('unknown')
    expect(JSON.stringify(evidence)).not.toContain('UNTRUSTED_SENTINEL')
    expect(Buffer.byteLength(JSON.stringify(evidence))).toBeLessThanOrEqual(32768)
    expect(readScanEvidence(evidence)).toEqual(evidence)
    expect(readScanEvidence({ ...evidence, comparison: { ...evidence.comparison, sitemapSource: value } })).toBeNull()
  })

  it('rejects coerced enum objects and inherited check identities', () => {
    const evidence = buildScanEvidence({...input(), checks: {c1_robots:{assessment:['pass'], collection:['complete'], reason:['provider-fallback']}}, observations:[{check:'constructor',collection:['complete']}]})
    expect(evidence.checks.c1_robots).toMatchObject({assessment:'not-verifiable',collection:'unknown',applicability:'not-verifiable'})
    expect(evidence.checks.c1_robots).not.toHaveProperty('reason')
    expect(evidence.observations[0]).toMatchObject({collection:'unknown'})
    expect(evidence.observations[0]).not.toHaveProperty('check')
    expect(readScanEvidence({...evidence,checks:{...evidence.checks,c1_robots:{...evidence.checks.c1_robots,collection:['unknown']}}})).toBeNull()
  })

})
