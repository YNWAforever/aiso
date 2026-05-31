import { describe, it, expect, vi } from 'vitest'
import { checkFactualDensity } from '@/lib/checks/factualDensity'

// Mock OpenRouter — eliminates ~1.5s LLM round-trip per test
vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(JSON.stringify({
    qualityScore: 75,
    hasComparativeData: true,
    hasTimeSeriesData: false,
    uniquenessScore: 60,
  })),
}))

const HTML_FACTUAL = `<html><body>
<p>In Q1 2024, revenue grew 23.4% to $4.2 billion, compared to $3.4 billion in Q1 2023.
The Harvard study in January 2024 included 12,000 participants across 15 countries.
Apple, Google, and Microsoft collectively hold 78% of the cloud market.</p>
</body></html>`

const HTML_VAGUE = `<html><body>
<p>Sales have been growing significantly. Our products are the best.
Many customers love what we do. We have been around for a long time.</p>
</body></html>`

describe('checkFactualDensity', () => {
  it('returns pass for factual content', async () => {
    const r = await checkFactualDensity(HTML_FACTUAL, { industry: 'finance', region: 'US' })
    expect(r.status).toBe('pass')
  })

  it('returns fail or warn for vague content', async () => {
    const r = await checkFactualDensity(HTML_VAGUE, { industry: 'finance', region: 'US' })
    expect(['fail', 'warn']).toContain(r.status)
  })

  it('result includes geoDetails with numberDensity', async () => {
    const r = await checkFactualDensity(HTML_FACTUAL, { industry: 'finance', region: 'US' })
    expect(r).toHaveProperty('geoDetails')
    expect(typeof r.geoDetails?.numberDensity).toBe('number')
  })

  it('detects date references in factual content', async () => {
    const r = await checkFactualDensity(HTML_FACTUAL, { industry: 'technology', region: 'global' })
    expect((r.geoDetails?.dateReferences ?? 0)).toBeGreaterThan(0)
  })

  it('handles empty HTML without throwing', async () => {
    const r = await checkFactualDensity('<html><body></body></html>', { industry: 'technology', region: 'global' })
    expect(['pass', 'warn', 'fail']).toContain(r.status)
  })
})
