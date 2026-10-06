import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeepGeoSection } from '@/components/result/DeepGeoSection'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { buildPublicResultSummary } from '@/lib/result-access'
import { buildScanEvidence, readScanEvidence, compareScanEvidence } from '@/lib/scan-evidence'
import { buildOwnerPriorities } from '@/lib/view-models/owner-priorities'
import historicalSeptember from '../fixtures/scan-evidence-20260905.json'
import historicalOctober from '../fixtures/scan-evidence-20261003.json'

const locale = vi.hoisted(() => ({ value: 'en' }))
vi.mock('next-intl', () => ({ useLocale: () => locale.value }))
const unavailable = { qualityScore: null, uniquenessScore: null, uniquenessStatus: 'unavailable', numberDensity: 2, namedEntityDensity: 1, dateReferences: 1, uniqueClaims: [] }
const observed = { ...unavailable, qualityScore: 20, uniquenessScore: 50, uniquenessStatus: 'observed' }
const input = { requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com', industry: 'technology', region: 'HK', sitemapSource: 'fetched' }

describe('factual density evidence projections', () => {
  it.each(['en', 'zh-HK'])('renders unavailable and legacy metrics honestly in %s', lang => {
    locale.value = lang
    for (const data of [unavailable, { ...observed, uniquenessStatus: undefined }, { ...observed, uniquenessScore: NaN }, { ...observed, qualityScore: Infinity }]) {
      const html = renderToStaticMarkup(<DeepGeoSection c18={data as never} />)
      expect(html).not.toMatch(/NaN|Infinity|50\/100|20\/100/)
      expect(html).toContain(lang === 'en' ? 'not measured' : '尚未量度')
      expect(html).toContain(lang === 'en' ? 'Number/stat density' : '數字／統計密度')
      expect(html).toContain(data.uniquenessStatus === undefined ? (lang === 'en' ? 'Legacy' : '歷史') : (lang === 'en' ? 'Unavailable' : '未能取得'))
    }
    const html = renderToStaticMarkup(<DeepGeoSection c18={observed as never} />)
    expect(html).toContain('50/100')
    expect(html).toContain(lang === 'en' ? 'not measured' : '尚未量度')
  })
  it.each(['en', 'zh-HK'])('renders a neutral unavailable check rather than a content failure in %s', lang => {
    locale.value = lang
    const html = renderToStaticMarkup(<ExpandableCheckItem label="Factual density" result={{ status: 'fail', message: 'factual_density_unavailable', details: 'Provider unavailable', diagnostic: { collection: 'partial', reason: 'provider-fallback' } }} message="factual_density_unavailable" />)
    expect(html).not.toContain('❌')
    expect(html).not.toContain('text-red-700')
    expect(html).toContain(lang === 'en' ? 'Unavailable' : '未能取得')
  })
  it('does not use malformed or legacy metrics for confirmed counts, top repair, or uplift', () => {
    const evidence = buildScanEvidence({ ...input, checks: { c18_factual_density: { collection: 'complete', assessment: 'fail' } } })
    for (const data of [unavailable, { ...observed, uniquenessStatus: undefined }, { ...observed, uniquenessScore: '50' }]) {
      const summary = buildPublicResultSummary({ id: 'synthetic', domain: 'example.com', score: 60, results: { evidence, c18_factual_density: { status: 'fail', message: 'factual_density_fail' }, c18_factual_density_data: data } as never })
      expect(summary.counts.fail).toBe(0)
      expect(summary.counts.unknown).toBeGreaterThan(0)
      expect(summary.topIssueKey).toBeNull()
      expect(summary.teaser.projectedScore).toBe(60)
    }
  })
  it('retains registered history without assigning factual-density provider provenance', () => {
    for (const history of [historicalSeptember, historicalOctober]) {
      expect(readScanEvidence(history)).toEqual(history)
      const withFailure = structuredClone(history)
      Object.assign(withFailure.checks.c18_factual_density, { collection: 'complete', assessment: 'fail', applicability: 'applicable' })
      // This fixture has a complete historical C18 failure. The immutable
      // envelope remains readable, while the priority view requires new evidence.
      expect(readScanEvidence(withFailure)).not.toBeNull()
      expect(buildOwnerPriorities(withFailure).priorities.some(item => item.checkKey === 'c18_factual_density')).toBe(false)
    }
    const current = buildScanEvidence({ ...input, checks: {} })
    expect(current.scannerVersion).toBe('2026-10-07.v1')
    expect(current.checks.c18_factual_density.version).toBe('2026-10-07.v1')
    expect(compareScanEvidence(historicalOctober, current).reason).toBe('different-methods-or-scope')
    expect(readScanEvidence({ ...current, scannerVersion: '2026-10-08.v1' })).toBeNull()
  })
})
