import { describe, it, expect, vi } from 'vitest'
import { checkFactualDensity } from '@/lib/checks/factualDensity'
import { callOpenRouter } from '@/lib/openrouter'

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

describe('checkFactualDensity — visible text only', () => {
  it('does not count CSS percentages or years in inline scripts as facts', async () => {
    // The audit's repro: three words of content scored "pass" on head CSS and
    // a config object.
    const html = `<html><head><style>.a{width:100%}.b{height:100%}.c{width:50%}.d{opacity:100%}.e{top:0%}</style><script>var cfg={"year":2024,"build":2023,"v":"Google Analytics Tag Manager"};</script></head><body><p>We sell shoes.</p></body></html>`
    const r = await checkFactualDensity(html, { industry: 'finance', region: 'US' })

    expect(r.status).toBe('fail')
    expect(r.geoDetails?.dateReferences).toBe(0)
  })
})

describe('checkFactualDensity — uniqueness provider', () => {
  const ctx = { industry: 'finance', region: 'US' } as const
  const model = vi.mocked(callOpenRouter)

  // Only the uniqueness term comes from the model; numbers, entities and dates
  // are deterministic and stay valid when it fails. The fallback used to store
  // an invented 50, rendered as a real "Content uniqueness 50/100" bar.
  it('does not invent a uniqueness score when the provider fails', async () => {
    model.mockRejectedValueOnce(new Error('provider down'))
    const r = await checkFactualDensity(HTML_FACTUAL, ctx)

    expect(r.geoDetails?.uniquenessScore).toBeNull()
    expect(r.diagnostic).toEqual({ collection: 'partial', reason: 'provider-fallback' })
  })

  it('scores the deterministic signals alone, rescaled, when uniqueness is unavailable', async () => {
    model.mockResolvedValueOnce(JSON.stringify({ score: 0, claims: [] }))
    const withZero = await checkFactualDensity(HTML_VAGUE, ctx)
    model.mockRejectedValueOnce(new Error('provider down'))
    const unavailable = await checkFactualDensity(HTML_VAGUE, ctx)

    // A uniqueness of 0 contributes nothing, so withZero is the deterministic
    // part; out of the 90 points it can reach, rescaled to 100.
    expect(unavailable.geoDetails?.qualityScore)
      .toBeCloseTo(Math.min(100, (withZero.geoDetails?.qualityScore ?? 0) * 100 / 90), 5)
  })

  it('clamps a model score outside 0-100', async () => {
    model.mockResolvedValueOnce(JSON.stringify({ score: 500, claims: ['x'] }))
    const r = await checkFactualDensity(HTML_FACTUAL, ctx)

    expect(r.geoDetails?.uniquenessScore).toBe(100)
  })

  it('treats a non-numeric score as unavailable instead of NaN', async () => {
    model.mockResolvedValueOnce(JSON.stringify({ score: 'high', claims: [] }))
    const r = await checkFactualDensity(HTML_FACTUAL, ctx)

    expect(r.geoDetails?.uniquenessScore).toBeNull()
    expect(Number.isFinite(r.geoDetails?.qualityScore)).toBe(true)
  })

  it('keeps only short string claims, at most three', async () => {
    model.mockResolvedValueOnce(JSON.stringify({ score: 70, claims: ['a', 42, 'b', 'c', 'd', 'x'.repeat(500)] }))
    const r = await checkFactualDensity(HTML_FACTUAL, ctx)

    expect(r.geoDetails?.uniqueClaims).toEqual(['a', 'b', 'c'])
  })
})
