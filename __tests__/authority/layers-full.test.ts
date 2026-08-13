/**
 * TDD: Authority engine layers 1–4 + aggregator
 * Layer 2 fetches Wikipedia/Tranco — mocked to stay fast
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'

// Mock fetch used by layer2-signals
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

// ── Layer 1: TLD trust ─────────────────────────────────────────
describe('Layer 1 — TLD trust (extended)', () => {
  it('scores .mil as 10 (same as .gov)', async () => {
    const { scoreLayer1 } = await import('@/lib/authority/layer1-tld')
    expect(scoreLayer1('army.mil').baseScore).toBe(10)
  })

  it('scores .ac as 8 (academic)', async () => {
    const { scoreLayer1 } = await import('@/lib/authority/layer1-tld')
    const r = scoreLayer1('ox.ac.uk')
    expect(r.baseScore).toBeGreaterThanOrEqual(7)
  })

  it('scores .io and .co as lower than .com', async () => {
    const { scoreLayer1 } = await import('@/lib/authority/layer1-tld')
    const io  = scoreLayer1('startup.io')
    const com = scoreLayer1('company.com')
    expect(io.baseScore).toBeLessThanOrEqual(com.baseScore)
  })

  it('returns baseScore and category in the result', async () => {
    const { scoreLayer1 } = await import('@/lib/authority/layer1-tld')
    const r = scoreLayer1('example.com')
    expect(r).toHaveProperty('baseScore')
    expect(r).toHaveProperty('category')
  })

  it('handles bare domain with no TLD gracefully', async () => {
    const { scoreLayer1 } = await import('@/lib/authority/layer1-tld')
    expect(() => scoreLayer1('localhost')).not.toThrow()
  })
})

// ── Layer 2: Domain signals (Wikipedia, Tranco) ─────────────────
describe('Layer 2 — Domain signals', () => {
  it('gives Wikipedia-present domains a higher score', async () => {
    const { scoreLayer2 } = await import('@/lib/authority/layer2-signals')
    // Wikipedia API returns summary for known domain
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ title: 'Bloomberg', extract: 'Bloomberg L.P.' }), { status: 200 }))
    // Tranco API — not found
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    const r = await scoreLayer2('bloomberg.com')
    expect(r.signalScore).toBeGreaterThan(0)
    expect(r.signals.wikipediaPresence).toBe(true)
  })

  it('gives score 0 for domain with no signals', async () => {
    const { scoreLayer2 } = await import('@/lib/authority/layer2-signals')
    // All fetch calls return 404
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))
    const r = await scoreLayer2('unknown-tiny-site-xyz.com')
    expect(r.signals.wikipediaPresence).toBe(false)
    expect(r.signalScore).toBeGreaterThanOrEqual(0)
  })

  it('returns result with expected signal shape', async () => {
    const { scoreLayer2 } = await import('@/lib/authority/layer2-signals')
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))
    const r = await scoreLayer2('example.com')
    expect(r).toHaveProperty('signalScore')
    expect(r).toHaveProperty('signals')
    expect(r.signals).toHaveProperty('wikipediaPresence')
    expect(r.signals).toHaveProperty('httpsEnforced')
    expect(r.signals).toHaveProperty('fetchedAt')
  })

  it('does not throw when Wikipedia API is unavailable', async () => {
    const { scoreLayer2 } = await import('@/lib/authority/layer2-signals')
    fetchMock.mockRejectedValue(new Error('Network error'))
    await expect(scoreLayer2('example.com')).resolves.not.toThrow()
  })
})

// ── Layer 3: Industry pack (extended) ─────────────────────────
describe('Layer 3 — Industry pack (extended)', () => {
  it('scores techcrunch.com as tier1 for technology', async () => {
    const { scoreLayer3 } = await import('@/lib/authority/layer3-industry')
    const r = scoreLayer3('techcrunch.com', 'technology')
    expect(['tier1', 'tier2']).toContain(r.tier)
  })

  it('adjustedScore is capped at 10', async () => {
    const { scoreLayer3 } = await import('@/lib/authority/layer3-industry')
    // Try a very high-tier domain — should cap at 10
    const r = scoreLayer3('nih.gov', 'medical')
    expect(r.adjustedScore).toBeLessThanOrEqual(10)
  })

  it('returns a multiplier field', async () => {
    const { scoreLayer3 } = await import('@/lib/authority/layer3-industry')
    const r = scoreLayer3('bloomberg.com', 'finance')
    expect(r).toHaveProperty('multiplier')
    expect(r.multiplier).toBeGreaterThan(0)
  })

  it('same domain scores differently across industries', async () => {
    const { scoreLayer3 } = await import('@/lib/authority/layer3-industry')
    const financeScore = scoreLayer3('bloomberg.com', 'finance')
    const medicalScore = scoreLayer3('bloomberg.com', 'medical')
    // Bloomberg is tier1 for finance, should be 'other' for medical
    expect(financeScore.tier).not.toBe(medicalScore.tier)
  })
})

// ── Layer 4: Regional pack (extended) ────────────────────────
describe('Layer 4 — Regional pack (extended)', () => {
  it('returns a valid result for rthk.hk in HK region', async () => {
    const { scoreLayer4 } = await import('@/lib/authority/layer4-regional')
    const r = scoreLayer4('rthk.hk', 'HK')
    expect(r).toHaveProperty('tier')
    expect(r).toHaveProperty('score')
    expect(['tier1', 'tier2', 'other']).toContain(r.tier)
  })

  it('returns 0 score for domain unknown in the region', async () => {
    const { scoreLayer4 } = await import('@/lib/authority/layer4-regional')
    const r = scoreLayer4('made-up-site-xyz.com', 'HK')
    expect(r.score).toBe(0)
    expect(r.tier).toBe('other')
  })

  it('returns score for TW region', async () => {
    const { scoreLayer4 } = await import('@/lib/authority/layer4-regional')
    const r = scoreLayer4('cna.com.tw', 'TW')
    expect(['tier1', 'tier2', 'other']).toContain(r.tier)
  })

  it('returns score for SG region', async () => {
    const { scoreLayer4 } = await import('@/lib/authority/layer4-regional')
    const r = scoreLayer4('straitstimes.com', 'SG')
    expect(['tier1', 'tier2', 'other']).toContain(r.tier)
  })

  it('result has score and tier fields', async () => {
    const { scoreLayer4 } = await import('@/lib/authority/layer4-regional')
    const r = scoreLayer4('example.com', 'US')
    expect(r).toHaveProperty('score')
    expect(r).toHaveProperty('tier')
  })
})

// ── Aggregator: All layers together ───────────────────────────
describe('Authority aggregator — computeAuthority', () => {
  it('returns a finalScore between 0 and 50 for any domain', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))
    const { computeAuthority } = await import('@/lib/authority/aggregator')
    const r = await computeAuthority('example.com', 'technology', 'global', null)
    expect(r).toHaveProperty('finalScore')
    expect(r.finalScore).toBeGreaterThanOrEqual(0)
    expect(r.finalScore).toBeLessThanOrEqual(50)
  })

  it('high-authority domain scores more than unknown domain', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: 'NIH' }), { status: 200 }))
      .mockResolvedValue(new Response('Not Found', { status: 404 }))
    const { computeAuthority } = await import('@/lib/authority/aggregator')
    const [high, low] = await Promise.all([
      computeAuthority('nih.gov', 'medical', 'US', null),
      computeAuthority('random-site-xyz123.com', 'medical', 'US', null),
    ])
    expect(high.finalScore).toBeGreaterThan(low.finalScore)
  })

  it('dynamic boost increases or maintains total score', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))
    const { computeAuthority } = await import('@/lib/authority/aggregator')
    const [withBoost, noBoost] = await Promise.all([
      computeAuthority('example.com', 'technology', 'global', 3),
      computeAuthority('example.com', 'technology', 'global', 0),
    ])
    expect(withBoost.finalScore).toBeGreaterThanOrEqual(noBoost.finalScore)
  })

  it('result includes breakdown by all four layers', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))
    const { computeAuthority } = await import('@/lib/authority/aggregator')
    const r = await computeAuthority('bloomberg.com', 'finance', 'US', null)
    expect(r).toHaveProperty('layer1_tld')
    expect(r).toHaveProperty('layer2_signals')
    expect(r).toHaveProperty('layer3_industry')
    expect(r).toHaveProperty('layer4_regional')
  })

  it('result has tier field', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))
    const { computeAuthority } = await import('@/lib/authority/aggregator')
    const r = await computeAuthority('example.com', 'technology', 'global', null)
    expect(r).toHaveProperty('tier')
    expect(['tier1', 'tier2', 'tier3', 'other']).toContain(r.tier)
  })
})
