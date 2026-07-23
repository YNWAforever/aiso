import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const callOpenRouter = vi.hoisted(() => vi.fn())
vi.mock('@/lib/openrouter', () => ({ callOpenRouter }))

import { polishReportSummary } from '@/lib/reports/ai'

const facts = {
  locale: 'en' as const,
  deterministicSummary: 'The current score is 82, a signed change of +7, with 3 evidence changes recorded.',
  currentScore: 82,
  previousScore: 75,
  signedDelta: '+7',
  comparisonState: 'comparable' as const,
  changeCounts: { improved: 2, regressed: 1, unchanged: 4, addedCoverage: 0, lostCoverage: 0, dataGap: 0 },
}

describe('report AI polish', () => {
  beforeEach(() => callOpenRouter.mockReset())

  it('sends one bounded request containing only whitelisted deterministic facts', async () => {
    callOpenRouter.mockResolvedValue('Visibility improved across the measured checks while one regression still needs focused follow-up from the client team.')

    const result = await polishReportSummary({
      ...facts,
      branding: { agencyName: 'SECRET AGENCY' },
      contactUrl: 'https://secret.example',
    } as typeof facts)

    expect(result).toMatchObject({ polished: true, code: 'ai_polished' })
    expect(callOpenRouter).toHaveBeenCalledTimes(1)
    const options = callOpenRouter.mock.calls[0]?.[0]
    expect(options.maxTokens).toBe(450)
    expect(options.signal).toBeInstanceOf(AbortSignal)
    const prompt = options.messages[1].content as string
    expect(prompt).toContain('"currentScore":82')
    expect(prompt).toContain('"signedDelta":"+7"')
    expect(prompt).not.toContain('SECRET AGENCY')
    expect(prompt).not.toContain('secret.example')
  })

  it('returns the deterministic fallback when the provider fails', async () => {
    callOpenRouter.mockImplementationOnce(async () => {
      throw new Error('provider unavailable')
    })

    await expect(polishReportSummary(facts)).resolves.toEqual({
      summary: facts.deterministicSummary,
      polished: false,
      code: 'ai_unavailable',
    })
    expect(callOpenRouter).toHaveBeenCalledTimes(1)
  })

  it('returns the deterministic fallback when the provider times out', async () => {
    callOpenRouter.mockImplementationOnce(async () => {
      throw new DOMException('timed out', 'TimeoutError')
    })

    await expect(polishReportSummary(facts)).resolves.toEqual({
      summary: facts.deterministicSummary,
      polished: false,
      code: 'ai_unavailable',
    })
    expect(callOpenRouter).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['HTML', () => callOpenRouter.mockResolvedValue('<p>This polished summary is long enough but contains HTML output.</p>'), 'ai_invalid_output'],
    ['Markdown link', () => callOpenRouter.mockResolvedValue('This summary includes [unsupported evidence](https://example.com) despite being long enough.'), 'ai_invalid_output'],
    ['Markdown emphasis', () => callOpenRouter.mockResolvedValue('This summary uses *unsupported emphasis* even though the sentence is otherwise long enough.'), 'ai_invalid_output'],
    ['Markdown blockquote', () => callOpenRouter.mockResolvedValue('> The measured evidence is improving, but this blockquote must never be accepted as plain text.'), 'ai_invalid_output'],
    ['Markdown ordered list', () => callOpenRouter.mockResolvedValue('1. The measured evidence is improving, but ordered list syntax is not valid plain text.'), 'ai_invalid_output'],
    ['Markdown heading', () => callOpenRouter.mockResolvedValue('# The measured evidence is improving, but a heading is not valid plain text output.'), 'ai_invalid_output'],
    ['Markdown code', () => callOpenRouter.mockResolvedValue('The measured evidence is improving, but `inline code` is not valid plain text output.'), 'ai_invalid_output'],
    ['unsupported numeric claim', () => callOpenRouter.mockResolvedValue('The current evidence is improving, and the business should expect 999 new visits from this work.'), 'ai_invalid_output'],
    ['fullwidth numeric bypass', () => callOpenRouter.mockResolvedValue('The current evidence is improving, and the business should expect ９９９ new visits from this work.'), 'ai_invalid_output'],
    ['Arabic numeric bypass', () => callOpenRouter.mockResolvedValue('The current evidence is improving, and the business should expect ٩٩٩ new visits from this work.'), 'ai_invalid_output'],
    ['Unicode signed numeric bypass', () => callOpenRouter.mockResolvedValue('The current evidence is improving, while an unsupported change of −999 is claimed for this work.'), 'ai_invalid_output'],
    ['Unicode percent bypass', () => callOpenRouter.mockResolvedValue('The current evidence is improving, while an unsupported result of ７％ is claimed for this work.'), 'ai_invalid_output'],
    ['Unicode currency bypass', () => callOpenRouter.mockResolvedValue('The current evidence is improving, while an unsupported return of ＄999 is claimed for this work.'), 'ai_invalid_output'],
    ['unsupported commercial claim', () => callOpenRouter.mockResolvedValue('The available evidence is improving and should increase revenue for the client over the next cycle.'), 'ai_invalid_output'],
    ['unsupported zh-HK claims', () => callOpenRouter.mockResolvedValue('目前可量度證據有所改善，並預計帶來更多收入、流量、排名及競爭對手優勢，但這些結論並不在既有事實之內。'), 'ai_invalid_output'],
  ])('returns the deterministic fallback for %s', async (_label, arrange, code) => {
    arrange()

    await expect(polishReportSummary(facts)).resolves.toEqual({
      summary: facts.deterministicSummary,
      polished: false,
      code,
    })
    expect(callOpenRouter).toHaveBeenCalledTimes(1)
  })

  it('accepts normalized plain text between 40 and 1200 characters with supported numbers only', async () => {
    callOpenRouter.mockResolvedValue('  The score of 82 reflects broader improvement, while the +7 change and 1 regression keep the next action focused.  ')

    await expect(polishReportSummary(facts)).resolves.toEqual({
      summary: 'The score of 82 reflects broader improvement, while the +7 change and 1 regression keep the next action focused.',
      polished: true,
      code: 'ai_polished',
    })
  })
})