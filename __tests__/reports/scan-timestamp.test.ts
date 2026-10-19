import { describe, expect, it } from 'vitest'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { buildScanEvidence } from '@/lib/scan-evidence'

const scanId = '33333333-3333-4333-8333-333333333333'

function suggestion(recordedAt: string) {
  const envelope = buildScanEvidence({
    requestedUrl: 'https://fixture-aiso.example',
    evaluatedUrl: 'https://fixture-aiso.example',
    industry: 'technology',
    region: 'HK',
    sitemapSource: 'unknown',
    checks: { c1_robots: { assessment: 'fail', collection: 'complete' } },
  })
  return deriveSuggestions({
    kind: 'scan-check',
    scanId,
    recordedAt,
    envelope,
  }).find(item => item.source.kind === 'scan-check'
    && item.source.checkKey === 'c1_robots')
}

describe('report scan timestamp normalization', () => {
  it('uses one canonical fingerprint for millisecond and microsecond timestamps', () => {
    const milliseconds = suggestion('2026-10-17T00:00:00.000Z')
    const microseconds = suggestion('2026-10-17T00:00:00.000000Z')

    expect(milliseconds).toBeDefined()
    expect(microseconds).toBeDefined()
    expect(microseconds!.fingerprint).toBe(milliseconds!.fingerprint)
    expect(microseconds!.evidence).toMatchObject({
      recordedAt: '2026-10-17T00:00:00.000Z',
    })
  })
})
