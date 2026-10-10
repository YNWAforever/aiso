import { afterEach, describe, it, expect, vi } from 'vitest'
import { DEFAULT_GROUNDED_ANSWERS_PER_WEEK, groundedAnswersCap, groundingFor, webSearchAllowance } from '@/lib/pulse/grounding'

type Call = { text: string; params: unknown[] }
function fakeSql(result: unknown[] | Error) {
  const calls: Call[] = []
  const sql = ((strings: TemplateStringsArray, ...params: unknown[]) => {
    calls.push({ text: strings.join('?'), params })
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  }) as never
  return { sql, calls }
}

afterEach(() => { vi.unstubAllEnvs() })

describe('groundingFor', () => {
  it('treats Perplexity as searching natively whatever the setting', () => {
    expect(groundingFor('perplexity-sonar', false)).toBe('native')
    expect(groundingFor('perplexity-sonar-pro', true)).toBe('native')
  })
  it('asks the other platforms to search only when web search is allowed', () => {
    expect(groundingFor('gpt-4o', true)).toBe('web')
    expect(groundingFor('claude-haiku', false)).toBe('none')
  })
})

describe('groundedAnswersCap', () => {
  it.each([
    [undefined, DEFAULT_GROUNDED_ANSWERS_PER_WEEK],
    ['20', 20],
    ['0', 0],
    ['abc', DEFAULT_GROUNDED_ANSWERS_PER_WEEK],
    ['-1', DEFAULT_GROUNDED_ANSWERS_PER_WEEK],
    ['2.5', DEFAULT_GROUNDED_ANSWERS_PER_WEEK],
  ])('PULSE_GROUNDED_ANSWERS_PER_WEEK=%s → %i', (value, cap) => {
    expect(groundedAnswersCap(value === undefined ? {} : { PULSE_GROUNDED_ANSWERS_PER_WEEK: value })).toBe(cap)
  })
  it('defaults to the structural ceiling: every prompt on every searching platform once', () => {
    expect(DEFAULT_GROUNDED_ANSWERS_PER_WEEK).toBe(150)
  })
})

describe('webSearchAllowance', () => {
  it('is off, and reads nothing, while the flag is off', async () => {
    const { sql, calls } = fakeSql([{ used: 0 }])
    expect(await webSearchAllowance(sql, 'acc-1', '2026-10-05')).toMatchObject({ allowed: false })
    expect(calls).toHaveLength(0)
  })

  it('allows web search under the cap and counts per account and week', async () => {
    vi.stubEnv('FEATURE_PULSE_GROUNDING', '1')
    vi.stubEnv('PULSE_GROUNDED_ANSWERS_PER_WEEK', '10')
    const { sql, calls } = fakeSql([{ used: 9 }])
    expect(await webSearchAllowance(sql, 'acc-1', '2026-10-05')).toEqual({ allowed: true, used: 9, cap: 10 })
    expect(calls[0].text).toMatch(/account_id/)
    expect(calls[0].params).toEqual(expect.arrayContaining(['acc-1', '2026-10-05']))
  })

  it('refuses at the cap', async () => {
    vi.stubEnv('FEATURE_PULSE_GROUNDING', '1')
    vi.stubEnv('PULSE_GROUNDED_ANSWERS_PER_WEEK', '10')
    expect((await webSearchAllowance(fakeSql([{ used: 10 }]).sql, 'acc-1', '2026-10-05')).allowed).toBe(false)
  })

  it('refuses with a cap of zero without reading', async () => {
    vi.stubEnv('FEATURE_PULSE_GROUNDING', '1')
    vi.stubEnv('PULSE_GROUNDED_ANSWERS_PER_WEEK', '0')
    const { sql, calls } = fakeSql([{ used: 0 }])
    expect((await webSearchAllowance(sql, 'acc-1', '2026-10-05')).allowed).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('fails closed when usage cannot be read', async () => {
    vi.stubEnv('FEATURE_PULSE_GROUNDING', '1')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await webSearchAllowance(fakeSql(new Error('db down')).sql, 'acc-1', '2026-10-05')).allowed).toBe(false)
    error.mockRestore()
  })
})
