import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PillarScoreCards } from '@/components/PillarScoreCards'
import { ScanEvidencePanel } from '@/components/result/ScanEvidencePanel'
import type { OwnedResultEvidence } from '@/lib/result-evidence'

const metrics = { earned: 0, maximum: 50, coverage: 0, checks: 11, covered: 0, passing: 0, warnings: 0, failing: 0 }
const snapshot = (state: 'insufficient_evidence' | 'provisional' | 'scored', score: number | null, coverage: number) => ({
  methodologyVersion: '2026-09-05.v2',
  ...Object.fromEntries(['seo', 'aeo', 'geo'].map(key => [key, { ...metrics, state, score, coverage }])),
})

describe('pillar evidence rendering', () => {
  it('suppresses numeric scores and progress bars when evidence is absent', () => {
    const html = renderToStaticMarkup(<PillarScoreCards results={{}} />)
    expect(html).toContain('Insufficient evidence')
    expect(html).not.toContain('role="progressbar"')
    expect(html).not.toContain('/100')
    expect(html).toContain('Weighted coverage: 0%')
    expect(html).toContain('2026-09-05.v2')
    expect(html).toContain('Recalculated')
  })
  it('labels provisional and scored snapshots and preserves a measured zero', () => {
    const provisional = renderToStaticMarkup(<PillarScoreCards results={{ pillarScores: snapshot('provisional', 0, 0.7) }} />)
    expect(provisional).toContain('Provisional')
    expect(provisional).toContain('aria-valuenow="0"')
    expect(provisional).toContain('Weighted coverage: 70%')
    const scored = renderToStaticMarkup(<PillarScoreCards results={{ pillarScores: snapshot('scored', 0, 0.9) }} locale="zh-HK" />)
    expect(scored).toContain('已評分')
  })
  it('labels immutable historical snapshots separately', () => {
    const legacy = { methodologyVersion: '2026-08-30.v1', ...Object.fromEntries(['seo','aeo','geo'].map(key => [key, { ...metrics, score: 42 }])) }
    const html = renderToStaticMarkup(<PillarScoreCards results={{ pillarScores: legacy }} />)
    expect(html).toContain('Historical stored score')
    expect(html).not.toContain('Recalculated')
  })
})

describe('owned evidence panel', () => {
  const evidence = { collection: 'partial', completedPages: 1, collectedAt: '2026-09-05T00:00:00Z', limited: true, scannerVersion: 'scanner-v1', methodologyVersion: 'method-v1', checks: [{ key: 'c1_robots', collection: 'failed', assessment: 'not-verifiable' }], pillarInputs: {} } as OwnedResultEvidence
  it('renders collection limits without implying a comparable improvement', () => {
    const html = renderToStaticMarkup(<ScanEvidencePanel evidence={evidence} locale="en" />)
    expect(html).toContain('Partial')
    expect(html).toContain('Not verifiable')
    expect(html).toContain('origin-only')
    expect(html).toContain('No comparable improvement claim')
    expect(html).toContain('scanner-v1')
  })
  it('renders missing timestamps as unknown', () => {
    const html = renderToStaticMarkup(<ScanEvidencePanel evidence={{ ...evidence, collectedAt: null }} locale="en" />)
    expect(html).toContain('Unknown')
    expect(html).not.toContain('<time')
  })
  it('localizes unknown collection and unavailable historic evidence', () => {
    const html = renderToStaticMarkup(<ScanEvidencePanel evidence={null} locale="zh-HK" />)
    expect(html).toContain('未有可核實的採集證據')
    expect(html).not.toContain('0%')
  })
})
