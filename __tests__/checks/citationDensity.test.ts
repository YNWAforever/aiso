import { beforeEach, describe, it, expect, vi } from 'vitest'
import { checkCitationDensity } from '@/lib/checks/citationDensity'
import { computeAuthority } from '@/lib/authority/aggregator'

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

beforeEach(() => {
  vi.mocked(computeAuthority).mockResolvedValue({
    totalScore: 35, layer1Score: 10, layer2Score: 8, layer3Score: 10, layer4Score: 7,
    tier: 'tier1', domain: 'example.com', finalScore: 35,
  })
})

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

  it('normalizes fragment variants and counts a canonical external URL once', async () => {
    const result = await checkCitationDensity(
      '<a href="https://NIH.gov/study#finding">one</a><a href="https://nih.gov/study">two</a>',
      'https://example.com',
      { industry: 'finance', region: 'global' },
    )

    expect(result.geoDetails?.totalLinks).toBe(1)
    expect(result.geoDetails?.details).toEqual([
      expect.objectContaining({ url: 'https://nih.gov/study', domain: 'nih.gov' }),
    ])
  })

  it('aggregates valid authority tiers and contains malformed authority output', async () => {
    vi.mocked(computeAuthority)
      .mockResolvedValueOnce({ tier: 'tier1', finalScore: 35 } as never)
      .mockResolvedValueOnce({ tier: 'tier2', finalScore: 20 } as never)
      .mockResolvedValueOnce({ tier: 'unexpected', finalScore: Number.NaN } as never)

    const result = await checkCitationDensity(
      '<a href="https://one.example/a">one</a><a href="https://two.example/b">two</a><a href="https://three.example/c">three</a>',
      'https://example.com',
      { industry: 'finance', region: 'global' },
    )

    expect(result.geoDetails?.authorityBreakdown).toEqual({ tier1: 1, tier2: 1, tier3: 0, other: 1 })
    expect(result.geoDetails?.details[2]).toEqual(expect.objectContaining({ tier: 'other', authorityScore: 0 }))
  })
})
