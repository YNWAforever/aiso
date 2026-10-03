import { describe, expect, it, vi } from 'vitest'
import { parseOnboardingInput, parseSeedPrompts } from '@/lib/onboarding/schema'
import { parsePromptContext, readPromptLanguage } from '@/lib/prompts/context'
const provider = vi.hoisted(() => vi.fn(async (_request: unknown) => '[]'))
vi.mock('@/lib/openrouter', () => ({ callOpenRouter: provider }))
vi.mock('@/lib/onboarding/store', () => ({}))
import { generateOnboardingSeed } from '@/lib/onboarding/service'

describe('T11 confirmed prompt context', () => {
  it('uses explicit brand defaults and allows market clearing', () => {
    expect(parsePromptContext({}, { language: 'zh-HK', market: 'HK' })).toEqual({ language: 'zh-HK', market: 'HK' })
    expect(parsePromptContext({ language: 'en', market: null }, { market: 'HK' })).toEqual({ language: 'en', market: null })
    expect(() => parsePromptContext({})).toThrow()
  })
  it('adapts specific old codes while preserving ambiguous codes as unknown', () => {
    expect(readPromptLanguage('en-US')).toBe('en')
    expect(readPromptLanguage('zh-Hant-HK')).toBe('zh-HK')
    for (const value of ['zh', 'zh-TW', 'fr', null]) expect(readPromptLanguage(value)).toBeNull()
  })
  it('refuses provider context mismatch and unknown market', () => {
    const seed = { category: 'brand_query', question: 'Synthetic?', language: 'en', market: 'US' }
    expect(() => parseSeedPrompts(JSON.stringify([seed]), { language: 'zh-HK', market: 'HK' })).toThrow()
    expect(() => parseSeedPrompts(JSON.stringify([{ ...seed, market: 'invented' }]))).toThrow()
  })
  it('seed_payload_contains_context in the actual provider request', async () => {
    await generateOnboardingSeed(parseOnboardingInput({ brandName: 'Synthetic', language: 'zh-HK', market: 'HK' }))
    const request = provider.mock.calls.at(-1)?.[0] as { messages: { content: string }[] }
    expect(request.messages[0].content).toContain('Language: zh-HK')
    expect(request.messages[0].content).toContain('Market: HK')
  })
  it.each(['fr', 'zh-TW', '', 42])('rejects unsupported confirmed language %j', language => {
    expect(() => parseOnboardingInput({ brandName: 'Synthetic', language })).toThrow()
  })
  it('does not silently label an ambiguous seed English', () => {
    expect(() => parseSeedPrompts('[{"category":"brand_query","question":"中文問題？"}]')).toThrow()
  })
})
