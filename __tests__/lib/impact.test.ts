/**
 * TDD: Impact engine — deterministic modelled estimates from scan results
 */
import { describe, it, expect } from 'vitest'
import { computeImpact as actualImpact } from '@/lib/impact'
// These arithmetic fixtures explicitly assert completed collection. Separate
// priority tests cover missing/partial evidence through the actual API.
function computeImpact(results: Record<string, unknown>, opts: Parameters<typeof actualImpact>[1]) {
  return actualImpact(results, { ...opts, confirmedChecks: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, {
    collection: 'complete', applicability: 'applicable', assessment: (value as { status?: unknown })?.status,
  }])) })
}

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
  it.each(['pass', 'warn', 'fail'] as const)('does not turn %s technical access into consumer exposure', status => {
    const r = computeImpact({ c1_robots: {status, message:'robots_ai_blocked'}, c3_bot_access: {status, message:'bots_all_blocked', details:'GPTBot, ClaudeBot'} }, {score:60})
    expect(r.platformVisibility).toHaveLength(5)
    expect(r.platformVisibility.every(p => p.status === 'not_measured')).toBe(true)
    expect(r.collectorAccess).toEqual([])
    expect(r.headlineStat.text).not.toContain('invisible')
  })
  it('keeps policy and fetch evidence distinct for the same crawler', () => {
    const r=computeImpact({c1_robots:{...pass(),collectorAccess:[{crawler:'GPTBot',role:'training',policy:'blocked',probe:'not_measured'}]}, c3_bot_access:{...pass(),collectorAccess:[{crawler:'GPTBot',role:'training',policy:'unknown',probe:'reachable'}]}},{score:80})
    expect(r.collectorAccess).toEqual([{crawler:'GPTBot',role:'training',policy:'blocked',probe:'reachable'}])
    expect(r.platformVisibility.every(p => p.status === 'not_measured')).toBe(true)
  })
  it('returns empty platform list when both c1 and c3 are missing', () => {
    expect(computeImpact({}, {score:50}).platformVisibility).toEqual([])
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
describe('computeImpact — checks that could not be assessed', () => {
  it('never offers an unmeasured check as a quick win', () => {
    // An unavailable c19 is left out of the GEO score; offering "Build out
    // topic clusters" for it would ask the customer to fix something that was
    // never measured, and count points the score never deducted.
    const results = allPassResults()
    results.c19_topical_authority = {
      status: 'warn', message: 'topical_authority_unavailable',
      diagnostic: { collection: 'failed', reason: 'provider-fallback' },
    } as never
    // Pass the evidence as capture.checks records it: a declared 'failed'
    // diagnostic becomes evidence collection 'failed', never 'complete'.
    const confirmedChecks = Object.fromEntries(Object.entries(results).map(([key, value]) => [key, {
      collection: (value as { diagnostic?: { collection?: string } })?.diagnostic?.collection ?? 'complete',
      applicability: 'applicable', assessment: (value as { status?: unknown })?.status,
    }]))
    const r = actualImpact(results, { score: 90, confirmedChecks })

    expect(r.quickWins.map(w => w.key)).not.toContain('c19_topical_authority')
  })
})

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

  it('ranks confirmed failures in stable check-key order', () => {
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
  it('prioritises recorded crawler restrictions without claiming consumer invisibility', () => {
    const results = allPassResults()
    results.c3_bot_access = { ...fail('bots_all_blocked'), collectorAccess: ['GPTBot', 'ClaudeBot', 'PerplexityBot'].map(crawler => ({
      crawler, role: crawler === 'PerplexityBot' ? 'search' : 'training', policy: 'unknown', probe: 'unreachable',
    })) }
    results.c5_extractability = fail() // low readable too
    const r = computeImpact(results, { score: 30, industry: 'technology' })
    expect(r.headlineStat.type).toBe('platforms_blocked')
    if (r.headlineStat.type === 'platforms_blocked') {
      expect(r.headlineStat.count).toBeGreaterThanOrEqual(3)
      expect(r.headlineStat.total).toBe(3)
      expect(r.headlineStat.text).not.toContain('invisible')
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

  it('does not invent a benchmark for low-scoring industry scans', () => {
    const r = computeImpact(allPassResults(), { score: 50, industry: 'technology' })
    expect(r.benchmark).toBeNull()
    expect(r.headlineStat.type).toBe('score_uplift')
    expect(r.headlineStat.text).not.toContain('average')
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
