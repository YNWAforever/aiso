import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/checks/robots',         () => ({ checkRobots:         vi.fn().mockResolvedValue({ status: 'pass', message: 'robots_ai_allowed' }) }))
vi.mock('@/lib/checks/llmsTxt',        () => ({ checkLlmsTxt:        vi.fn().mockResolvedValue({ status: 'fail', message: 'llms_txt_missing' }) }))
vi.mock('@/lib/checks/botAccess',      () => ({ checkBotAccess:      vi.fn().mockResolvedValue({ status: 'pass', message: 'bots_all_accessible' }) }))
vi.mock('@/lib/checks/structuredData', () => ({ checkStructuredData: vi.fn().mockResolvedValue({ status: 'pass', message: 'structured_data_found' }) }))
vi.mock('@/lib/checks/extractability', () => ({ checkExtractability: vi.fn().mockResolvedValue({ status: 'pass', message: 'extractability_good' }) }))

import { calculateScore, calculateGeoScore } from '@/app/api/scan/route'

describe('calculateScore', () => {
  it('scores core checks with correct weights (12+10+10+7+6=45 max)', () => {
    const results = {
      c1_robots:          { status: 'pass' as const, message: '' },
      c2_llms_txt:        { status: 'fail' as const, message: '' },
      c3_bot_access:      { status: 'pass' as const, message: '' },
      c4_structured_data: { status: 'pass' as const, message: '' },
      c5_extractability:  { status: 'pass' as const, message: '' },
    }
    // c1(12) + c2(0) + c3(10) + c4(7) + c5(6) = 35
    expect(calculateScore(results)).toBe(35)
  })

  it('returns 0 when all checks fail', () => {
    const results = {
      c1_robots:          { status: 'fail' as const, message: '' },
      c2_llms_txt:        { status: 'fail' as const, message: '' },
      c3_bot_access:      { status: 'fail' as const, message: '' },
      c4_structured_data: { status: 'fail' as const, message: '' },
      c5_extractability:  { status: 'fail' as const, message: '' },
    }
    expect(calculateScore(results)).toBe(0)
  })

  it('gives warn 50% credit per check (22.5 of 45 max)', () => {
    const results = {
      c1_robots:          { status: 'warn' as const, message: '' },
      c2_llms_txt:        { status: 'warn' as const, message: '' },
      c3_bot_access:      { status: 'warn' as const, message: '' },
      c4_structured_data: { status: 'warn' as const, message: '' },
      c5_extractability:  { status: 'warn' as const, message: '' },
    }
    // (12+10+10+7+6) * 0.5 = 22.5
    expect(calculateScore(results)).toBe(22.5)
  })
})

describe('calculateGeoScore', () => {
  it('scores GEO checks with correct weights (7+6+7+5=25 max)', () => {
    const results = {
      c17_citation_density:  { status: 'pass' as const, message: '' },
      c18_factual_density:   { status: 'fail' as const, message: '' },
      c19_topical_authority: { status: 'pass' as const, message: '' },
      c20_chunkability:      { status: 'pass' as const, message: '' },
    }
    // c17(7) + c18(0) + c19(7) + c20(5) = 19
    expect(calculateGeoScore(results)).toBe(19)
  })

  it('returns 0 when all GEO checks fail', () => {
    const results = {
      c17_citation_density:  { status: 'fail' as const, message: '' },
      c18_factual_density:   { status: 'fail' as const, message: '' },
      c19_topical_authority: { status: 'fail' as const, message: '' },
      c20_chunkability:      { status: 'fail' as const, message: '' },
    }
    expect(calculateGeoScore(results)).toBe(0)
  })

  it('gives warn 50% credit per check (12.5 of 25 max)', () => {
    const results = {
      c17_citation_density:  { status: 'warn' as const, message: '' },
      c18_factual_density:   { status: 'warn' as const, message: '' },
      c19_topical_authority: { status: 'warn' as const, message: '' },
      c20_chunkability:      { status: 'warn' as const, message: '' },
    }
    // (7+6+7+5) * 0.5 = 12.5
    expect(calculateGeoScore(results)).toBe(12.5)
  })

  it('treats a missing check key as fail (0 points), not a crash', () => {
    // Only c17 provided — c18/c19/c20 absent entirely from the object.
    const results = { c17_citation_density: { status: 'pass' as const, message: '' } }
    expect(calculateGeoScore(results)).toBe(7)
  })
})
