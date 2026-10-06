import { beforeEach, describe, it, expect, vi } from 'vitest'
import { checkFactualDensity, parseFactualUniqueness } from '@/lib/checks/factualDensity'
import { callOpenRouter } from '@/lib/openrouter'

// Mock OpenRouter — eliminates ~1.5s LLM round-trip per test
vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn(),
}))

beforeEach(() => { vi.mocked(callOpenRouter).mockResolvedValue(JSON.stringify({ score: 60, claims: [] })) })

const HTML_FACTUAL = `<html><body>
<p>In Q1 2024, revenue grew 23.4% to $4.2 billion, compared to $3.4 billion in Q1 2023.
The Harvard study in January 2024 included 12,000 participants across 15 countries.
Apple, Google, and Microsoft collectively hold 78% of the cloud market.</p>
</body></html>`

describe('untrusted uniqueness boundary', () => {
  it.each([null, [], {}, { score: NaN, claims: [] }, { score: Infinity, claims: [] }, { score: -Infinity, claims: [] }, { score: '50', claims: [] }, { score: 50.1, claims: [] }, { score: 50, claims: [' '.repeat(5)] }, { score: 50, claims: ['x'.repeat(501)] }])('rejects malformed values without coercion', value => {
    expect(parseFactualUniqueness(value)).toBeNull()
  })
  it('accepts a genuine neutral score and bounded trimmed claims', () => {
    expect(parseFactualUniqueness({ score: 50, claims: [' A ', 'x'.repeat(500)] })).toEqual({ score: 50, claims: ['A', 'x'.repeat(500)] })
  })
})

const HTML_VAGUE = `<html><body>
<p>Sales have been growing significantly. Our products are the best.
Many customers love what we do. We have been around for a long time.</p>
</body></html>`

describe('checkFactualDensity', () => {
  it('provider outage preserves deterministic counts but never invents uniqueness or quality', async () => {
    vi.mocked(callOpenRouter).mockRejectedValue(new Error('synthetic provider outage'))
    const r = await checkFactualDensity(HTML_FACTUAL, { industry: 'finance', region: 'US' })
    expect(r.geoDetails).toMatchObject({ uniquenessScore: null, qualityScore: null, uniquenessStatus: 'unavailable', uniqueClaims: [] })
    expect(r.geoDetails!.numberDensity).toBeGreaterThan(0)
    expect(r.status).toBe('fail') // Compatibility no-credit sentinel, not a content finding.
    expect(r.message).toBe('factual_density_unavailable')
    expect(r.diagnostic).toEqual({ collection: 'partial', reason: 'provider-fallback' })
    expect(r.details).not.toMatch(/Quality score|NaN|50\/100/)
  })

  it.each([
    'not JSON', '{}', '{"score":null,"claims":[]}', '{"score":"50","claims":[]}',
    '{"score":"invalid","claims":[]}', '{"score":true,"claims":[]}',
    '{"score":-1,"claims":[]}', '{"score":101,"claims":[]}', '{"score":1.5,"claims":[]}',
    '{"score":50}', '{"score":50,"claims":null}', '{"score":50,"claims":[1]}',
    '{"score":50,"claims":[""]}', '{"score":50,"claims":["   "]}',
    JSON.stringify({ score: 50, claims: ['a', 'b', 'c', 'd'] }),
    JSON.stringify({ score: 50, claims: ['x'.repeat(501)] }),
  ])('invalid provider response yields unavailable metrics: %s', async response => {
    vi.mocked(callOpenRouter).mockResolvedValue(response)
    const r = await checkFactualDensity(HTML_VAGUE, { industry: 'finance', region: 'US' })
    expect(r.geoDetails).toMatchObject({ uniquenessScore: null, qualityScore: null, uniquenessStatus: 'unavailable', uniqueClaims: [] })
    expect(r.diagnostic?.collection).toBe('partial')
    expect(r.details).not.toContain('NaN')
  })

  it.each([0, 50, 100])('valid score %i and empty claims survive without coercion', async score => {
    vi.mocked(callOpenRouter).mockResolvedValue(JSON.stringify({ score, claims: [] }))
    const r = await checkFactualDensity(HTML_VAGUE, { industry: 'finance', region: 'US' })
    expect(r.geoDetails).toMatchObject({ uniquenessScore: score, uniquenessStatus: 'observed', uniqueClaims: [] })
    expect(Number.isFinite(r.geoDetails!.qualityScore)).toBe(true)
    expect(r.diagnostic?.collection).toBe('complete')
  })

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
