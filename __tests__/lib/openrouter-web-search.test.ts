import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callMultiPlatform, callOpenRouterWithEvidence } from '@/lib/openrouter'

const ANNOTATIONS = [{ type: 'url_citation', url_citation: { url: 'https://hsbc.com.hk/', title: 'HSBC', start_index: 0, end_index: 4 } }]
const completion = { id: 'gen-1', model: 'x', choices: [{ finish_reason: 'stop', message: { content: 'An answer.', annotations: ANNOTATIONS } }], usage: {} }

let fetchMock: ReturnType<typeof vi.fn>
const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(completion), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('web search request shape', () => {
  it('adds the web plugin and low search context only when asked', async () => {
    await callOpenRouterWithEvidence({ label: 'pulse.platform', model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'Q' }], webSearch: true })
    await callOpenRouterWithEvidence({ label: 'pulse.platform', model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'Q' }] })
    const [searched, plain] = bodies()
    expect(searched.plugins).toEqual([{ id: 'web', max_results: 5 }])
    expect(searched.web_search_options).toEqual({ search_context_size: 'low' })
    expect(plain.plugins).toBeUndefined()
    expect(plain.web_search_options).toBeUndefined()
  })
})

describe('callMultiPlatform', () => {
  it('asks only platforms that do not search natively to search, and returns citations and grounding', async () => {
    const results = await callMultiPlatform([{ role: 'user', content: 'Q' }], 500, ['perplexity-sonar', 'gpt-4o'], undefined, { webSearch: true })
    const byModel = Object.fromEntries(bodies().map(b => [b.model, b]))
    expect(byModel['perplexity/sonar'].plugins).toBeUndefined()
    expect(byModel['openai/gpt-4o'].plugins).toEqual([{ id: 'web', max_results: 5 }])
    expect(results).toEqual(expect.arrayContaining([
      { platform: 'perplexity-sonar', answer: 'An answer.', grounding: 'native', providerCitations: [{ url: 'https://hsbc.com.hk/', title: 'HSBC' }] },
      { platform: 'gpt-4o', answer: 'An answer.', grounding: 'web', providerCitations: [{ url: 'https://hsbc.com.hk/', title: 'HSBC' }] },
    ]))
  })

  it('never searches when web search is not allowed, and says so', async () => {
    const [result] = await callMultiPlatform([{ role: 'user', content: 'Q' }], 500, ['claude-haiku'])
    expect(bodies()[0].plugins).toBeUndefined()
    expect(result.grounding).toBe('none')
  })
})
