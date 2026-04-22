import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/checks/robots',         () => ({ checkRobots:         vi.fn().mockResolvedValue({ status: 'pass', message: 'robots_ai_allowed' }) }))
vi.mock('@/lib/checks/llmsTxt',        () => ({ checkLlmsTxt:        vi.fn().mockResolvedValue({ status: 'fail', message: 'llms_txt_missing' }) }))
vi.mock('@/lib/checks/botAccess',      () => ({ checkBotAccess:      vi.fn().mockResolvedValue({ status: 'pass', message: 'bots_all_accessible' }) }))
vi.mock('@/lib/checks/structuredData', () => ({ checkStructuredData: vi.fn().mockResolvedValue({ status: 'pass', message: 'structured_data_found' }) }))
vi.mock('@/lib/checks/extractability', () => ({ checkExtractability: vi.fn().mockResolvedValue({ status: 'pass', message: 'extractability_good' }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'test-uuid' }, error: null }),
        }),
      }),
    }),
  },
}))

import { calculateScore } from '@/app/api/scan/route'

describe('calculateScore', () => {
  it('gives C3 30% weight, others 17.5%', () => {
    const results = {
      c1_robots:          { status: 'pass' as const, message: '' },
      c2_llms_txt:        { status: 'fail' as const, message: '' },
      c3_bot_access:      { status: 'pass' as const, message: '' },
      c4_structured_data: { status: 'pass' as const, message: '' },
      c5_extractability:  { status: 'pass' as const, message: '' },
    }
    // pass=100: c1(17.5) + c3(30) + c4(17.5) + c5(17.5) = 82.5
    expect(calculateScore(results)).toBeCloseTo(82.5)
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

  it('gives warn 50 points', () => {
    const results = {
      c1_robots:          { status: 'warn' as const, message: '' },
      c2_llms_txt:        { status: 'warn' as const, message: '' },
      c3_bot_access:      { status: 'warn' as const, message: '' },
      c4_structured_data: { status: 'warn' as const, message: '' },
      c5_extractability:  { status: 'warn' as const, message: '' },
    }
    expect(calculateScore(results)).toBeCloseTo(50)
  })
})
