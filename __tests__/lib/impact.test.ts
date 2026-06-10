/**
 * TDD: Impact engine — deterministic modelled estimates from scan results
 */
import { describe, it, expect } from 'vitest'
import { computeImpact, INDUSTRY_BENCHMARKS } from '@/lib/impact'

// ── Fixtures ────────────────────────────────────────────────────
const pass = (msg = 'ok')  => ({ status: 'pass' as const, message: msg })
const warn = (msg = 'w')   => ({ status: 'warn' as const, message: msg })
const fail = (msg = 'f', details?: string) => ({ status: 'fail' as const, message: msg, ...(details ? { details } : {}) })

/** A scan where everything passes */
function allPassResults(): Record<string, unknown> {
  return {
    c1_robots: pass('robots_ai_allowed'),
    c2_llms_txt: pass(), c3_bot_access: pass('bots_all_accessible'),
    c4_structured_data: pass(), c5_extractability: pass(),
    c6_llms_full_txt: pass(), c7_mcp_card: pass(), c8_sitemap: pass(),
    c9_meta_desc: pass(), c10_headings: pass(), c11_faq: pass(),
    c12_canonical: pass(), c13_render: pass(), c14_internal_links: pass(),
    c15_entity: pass(), c16_freshness: pass(),
    c17_citation_density: pass(), c18_factual_density: pass(),
    c19_topical_authority: pass(), c20_chunkability: pass(),
    c20_chunkability_data: { optimalChunkRatio: 90 },
  }
}

// ── Platform visibility ─────────────────────────────────────────
describe('computeImpact — platformVisibility', () => {
  it('marks all 5 platforms visible when c1 + c3 pass', () => {
    const r = computeImpact(allPassResults(), { score: 95 })
    expect(r.platformVisibility).toHaveLength(5)
    expect(r.platformVisibility.every(p => p.status === 'visible')).toBe(true)
  })

  it('marks named bots blocked from c3 details', () => {
    const results = allPassResults()
    results.c3_bot_access = warn('bots_partially_blocked')
    ;(results.c3_bot_access as { details?: string }).details = 'GPTBot, ClaudeBot'
    const r = computeImpact(results, { score: 60 })
    const byKey = Object.fromEntries(r.platformVisibility.map(p => [p.platform, p.status]))
    expect(byKey.chatgpt).toBe('blocked')
    expect(byKey.claude).toBe('blocked')
    expect(byKey.perplexity).toBe('visible')
  })

  it('blocks all c3-tested platforms when bots_all_blocked with no details', () => {
    const results = allPassResults()
    results.c3_bot_access = fail('bots_all_blocked')
    const r = computeImpact(results, { score: 40 })
    const byKey = Object.fromEntries(r.platformVisibility.map(p => [p.platform, p.status]))
    expect(byKey.chatgpt).toBe('blocked')
    expect(byKey.claude).toBe('blocked')
    expect(byKey.perplexity).toBe('blocked')
  })

  it('downgrades platforms to partial when robots.txt blocks AI crawlers', () => {
    const results = allPassResults()
    results.c1_robots = fail('robots_ai_blocked')
    const r = computeImpact(results, { score: 60 })
    const byKey = Object.fromEntries(r.platformVisibility.map(p => [p.platform, p.status]))
    // c3 passed so server lets bots in, but robots.txt disallows some — partial
    expect(byKey.gemini).toBe('partial')
    expect(byKey.google_aio).toBe('partial')
    expect(byKey.chatgpt).toBe('partial')
  })

  it('marks gemini/google_aio partial when robots.txt is missing (unverifiable)', () => {
    const results = allPassResults()
    results.c1_robots = fail('robots_not_found')
    const r = computeImpact(results, { score: 60 })
    const byKey = Object.fromEntries(r.platformVisibility.map(p => [p.platform, p.status]))
    expect(byKey.gemini).toBe('partial')
    // c3-verified platforms stay visible — server actually let the bots in
    expect(byKey.chatgpt).toBe('visible')
  })

  it('returns empty platform list when both c1 and c3 are missing', () => {
    const r = computeImpact({}, { score: 50 })
    expect(r.platformVisibility).toEqual([])
  })
})

// ── AI-readable percent ─────────────────────────────────────────
describe('computeImpact — aiReadablePercent', () => {
  it('blends c5, c13 and chunk ratio', () => {
    const results = allPassResults() // pass(100) + pass(100) + ratio 90
    const r = computeImpact(results, { score: 95 })
    expect(r.aiReadablePercent).toBe(97) // round((100+100+90)/3)
  })

  it('uses only available signals', () => {
    const r = computeImpact({ c5_extractability: fail() }, { score: 30 })
    expect(r.aiReadablePercent).toBe(20)
  })

  it('returns null when no readability signals exist', () => {
    const r = computeImpact({ c1_robots: pass() }, { score: 50 })
    expect(r.aiReadablePercent).toBeNull()
  })
})

// ── Quick wins + projection ─────────────────────────────────────
describe('computeImpact — quickWins & projection', () => {
  it('returns no quick wins and zero uplift for a perfect scan', () => {
    const r = computeImpact(allPassResults(), { score: 100 })
    expect(r.quickWins).toEqual([])
    expect(r.projectedScore).toBe(100)
  })

  it('awards full weight for fail and half for warn', () => {
    const results = allPassResults()
    results.c2_llms_txt = fail()        // 10 pts, minutes
    results.c11_faq    = warn()         // 1.5 pts, hours
    const r = computeImpact(results, { score: 70 })
    const llms = r.quickWins.find(q => q.key === 'c2_llms_txt')
    const faq  = r.quickWins.find(q => q.key === 'c11_faq')
    expect(llms?.pointsGain).toBe(10)
    expect(faq?.pointsGain).toBe(1.5)
  })

  it('ranks fast high-point fixes first', () => {
    const results = allPassResults()
    results.c2_llms_txt = fail()          // 10 pts minutes
    results.c9_meta_desc = fail()         // 2 pts hours
    const r = computeImpact(results, { score: 60 })
    expect(r.quickWins[0]?.key).toBe('c2_llms_txt')
  })

  it('projects score from wins with effort below days, capped at 100', () => {
    const results = allPassResults()
    results.c2_llms_txt   = fail()              // +10, minutes
    results.c11_faq       = fail()              // +3, hours
    results.c3_bot_access = fail('bots_all_blocked') // +10 but days — excluded
    const r = computeImpact(results, { score: 50, grade: 'D' })
    expect(r.projectedScore).toBe(63)
    expect(r.projectedGrade).toBe('C')
  })

  it('caps projected score at 100', () => {
    const results = allPassResults()
    results.c2_llms_txt = fail()
    const r = computeImpact(results, { score: 95 })
    expect(r.projectedScore).toBe(100)
  })
})

// ── Headline stat priority ──────────────────────────────────────
describe('computeImpact — headlineStat', () => {
  it('prioritises blocked platforms above everything', () => {
    const results = allPassResults()
    results.c3_bot_access = fail('bots_all_blocked')
    results.c5_extractability = fail() // low readable too
    const r = computeImpact(results, { score: 30, industry: 'technology' })
    expect(r.headlineStat.type).toBe('platforms_blocked')
    if (r.headlineStat.type === 'platforms_blocked') {
      expect(r.headlineStat.count).toBeGreaterThanOrEqual(3)
      expect(r.headlineStat.total).toBe(5)
    }
  })

  it('falls to low_readable when nothing is blocked but readability < 50', () => {
    const results = allPassResults()
    results.c5_extractability = fail()
    results.c13_render = fail()
    results.c20_chunkability_data = { optimalChunkRatio: 20 }
    const r = computeImpact(results, { score: 55 })
    expect(r.headlineStat.type).toBe('low_readable')
  })

  it('falls to benchmark_gap when below industry average', () => {
    const r = computeImpact(allPassResults(), { score: 50, industry: 'technology' })
    expect(r.headlineStat.type).toBe('benchmark_gap')
    if (r.headlineStat.type === 'benchmark_gap') {
      expect(r.headlineStat.benchmark).toBe(INDUSTRY_BENCHMARKS.technology)
      expect(r.headlineStat.gap).toBe(INDUSTRY_BENCHMARKS.technology! - 50)
    }
  })

  it('falls back to score_uplift otherwise', () => {
    const results = allPassResults()
    results.c11_faq = fail()
    const r = computeImpact(results, { score: 90, industry: 'technology' })
    expect(r.headlineStat.type).toBe('score_uplift')
  })

  it('every headline carries human-readable text', () => {
    const r = computeImpact(allPassResults(), { score: 95 })
    expect(typeof r.headlineStat.text).toBe('string')
    expect(r.headlineStat.text.length).toBeGreaterThan(0)
  })
})

// ── Degradation ─────────────────────────────────────────────────
describe('computeImpact — legacy / malformed input', () => {
  it('never throws on empty results', () => {
    const r = computeImpact({}, { score: 0 })
    expect(r.quickWins).toEqual([])
    expect(r.aiReadablePercent).toBeNull()
    expect(r.projectedScore).toBe(0)
  })

  it('never throws on garbage values', () => {
    const r = computeImpact(
      { c1_robots: 'not-an-object', c5_extractability: 42, c20_chunkability_data: null },
      { score: 50 },
    )
    expect(r.projectedScore).toBeGreaterThanOrEqual(50)
  })
})
