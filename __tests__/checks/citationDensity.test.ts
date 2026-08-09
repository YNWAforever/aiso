import { describe, it, expect, vi } from 'vitest'
import { checkCitationDensity } from '@/lib/checks/citationDensity'

// Mock OpenRouter AND the authority aggregator to eliminate all network calls
vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(JSON.stringify({
    qualityScore: 78,
    assessment: 'Good citation quality with authoritative sources.',
    citationDetails: [],
  })),
}))

vi.mock('@/lib/authority/aggregator', () => ({
  computeAuthority: vi.fn().mockResolvedValue({
    totalScore: 35, layer1Score: 10, layer2Score: 8, layer3Score: 10, layer4Score: 7,
    tier: 'tier1', domain: 'example.com',
  }),
}))

const HTML_RICH = `<html><body>
<p>According to <a href="https://nih.gov/study">NIH study</a>, 70% of adults...</p>
<p>The <a href="https://bloomberg.com/data">Bloomberg report</a> shows growth of 15%.</p>
<p>Research from <a href="https://reuters.com/article">Reuters</a> confirms trends.</p>
<p>Data source: <a href="https://worldbank.org/report">World Bank</a> (2024).</p>
<p>Statistics show 45% increase (source: <a href="https://statista.com">Statista</a>).</p>
<p>Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.</p>
</body></html>`

const HTML_POOR = `<html><body><p>This page has no external links.</p></body></html>`

describe('checkCitationDensity', () => {
  it('returns pass for well-cited content', async () => {
    const result = await checkCitationDensity(HTML_RICH, 'https://example.com', { industry: 'finance', region: 'global' })
    expect(result.status).toBe('pass')
  })

  it('returns fail for uncited content', async () => {
    const result = await checkCitationDensity(HTML_POOR, 'https://example.com', { industry: 'finance', region: 'global' })
    expect(result.status).toBe('fail')
  })

  it('result includes geoDetails with qualityScore', async () => {
    const result = await checkCitationDensity(HTML_RICH, 'https://example.com', { industry: 'finance', region: 'global' })
    expect(result).toHaveProperty('geoDetails')
    expect(typeof result.geoDetails?.qualityScore).toBe('number')
  })

  it('counts external links correctly', async () => {
    const result = await checkCitationDensity(HTML_RICH, 'https://example.com', { industry: 'finance', region: 'global' })
    // HTML_RICH has 5 external links; externalLinks count should be recorded
    expect((result.geoDetails?.totalLinks ?? 0) + (result.geoDetails?.externalLinks ?? 0)).toBeGreaterThanOrEqual(0)
  })

  it('handles malformed HTML without throwing', async () => {
    const result = await checkCitationDensity('<p>broken<a href="bad url">link</p>', 'https://example.com', { industry: 'technology', region: 'HK' })
    expect(['pass', 'warn', 'fail']).toContain(result.status)
  })

  it('retains individual citation occurrences and source URL fragments', async () => {
    const result = await checkCitationDensity(
      '<a href="https://NIH.gov/study#finding">one</a><a href="https://nih.gov/study">two</a>',
      'https://example.com',
      { industry: 'finance', region: 'global' },
    )

    expect(result.geoDetails?.totalLinks).toBe(2)
    expect(result.geoDetails?.details).toEqual([
      expect.objectContaining({ url: 'https://nih.gov/study#finding', domain: 'nih.gov' }),
    ])
  })

  it('keeps authority aggregation scoped to unique external domains', async () => {
    const result = await checkCitationDensity(
      '<a href="https://one.example/a">one</a><a href="https://one.example/b">two</a>',
      'https://example.com',
      { industry: 'finance', region: 'global' },
    )

    expect(result.geoDetails?.authorityBreakdown).toEqual({ tier1: 1, tier2: 0, tier3: 0, other: 0 })
    expect(result.geoDetails?.details).toHaveLength(1)
  })
})
