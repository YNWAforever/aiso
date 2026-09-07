import { describe, expect, it } from 'vitest'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { buildOwnedResultEvidence } from '@/lib/result-evidence'

const evidence = () => buildScanEvidence({
  requestedUrl: 'https://example.com/private?token=SECRET', evaluatedUrl: 'https://example.com',
  industry: 'technology', region: 'HK', sitemapSource: 'fetched',
  collectedAt: '2026-09-05T00:00:00.000Z',
  checks: { c1_robots: { collection: 'failed', assessment: 'not-verifiable', reason: 'fetch-failed' } },
})

describe('owned result evidence projection', () => {
  it('returns null for absent or malformed historical evidence', () => {
    expect(buildOwnedResultEvidence(undefined)).toBeNull()
    expect(buildOwnedResultEvidence({ collection: 'complete', checks: {} })).toBeNull()
  })
  it('projects validated evidence without URLs, observations, signatures or raw data', () => {
    const dto = buildOwnedResultEvidence(evidence())!
    expect(dto).toMatchObject({ collection: 'unknown', completedPages: 0, collectedAt: '2026-09-05T00:00:00.000Z' })
    expect(dto.checks).toHaveLength(20)
    expect(dto.checks.find(check => check.key === 'c1_robots')).toMatchObject({ collection: 'failed', assessment: 'not-verifiable' })
    expect(Object.keys(dto).sort()).toEqual(['checks','collectedAt','collection','completedPages','limited','methodologyVersion','pillarInputs','scannerVersion'].sort())
    expect(JSON.stringify(dto)).not.toMatch(/SECRET|example\.com|comparisonSignature|observations/)
  })
  it('fails closed when an otherwise valid envelope has an added untrusted field', () => {
    expect(buildOwnedResultEvidence({ ...evidence(), injected: 'SECRET' })).toBeNull()
  })
})