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

describe('attribution', () => {
  // It used to hardcode aeo.fimmick.com, which no longer resolves.
  it('names the app origin as the referer', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://one-host.example.com')
    await callOpenRouterWithEvidence({ label: 'pulse.platform', model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'Q' }] })
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['HTTP-Referer']).toBe('https://one-host.example.com')
  })
})

describe('web search request shape', () => {
  it('sends explicit monitoring sampling only when requested', async () => {
    await callOpenRouterWithEvidence({label:'pulse.platform',model:'openai/gpt-4o',messages:[{role:'user',content:'Q'}],temperature:0.2})
    expect(bodies()[0].temperature).toBe(0.2)
    await callOpenRouterWithEvidence({label:'pulse.platform',model:'openai/gpt-4o',messages:[{role:'user',content:'Q'}]})
    expect(bodies()[1].temperature).toBeUndefined()
  })
  it('adds the web plugin and low search context only when asked', async () => {
    await callOpenRouterWithEvidence({ label: 'pulse.platform', model: 'anthropic/claude-haiku-4-5', messages: [{ role: 'user', content: 'Q' }], webSearch: true })
    await callOpenRouterWithEvidence({ label: 'pulse.platform', model: 'anthropic/claude-haiku-4-5', messages: [{ role: 'user', content: 'Q' }] })
    const [searched, plain] = bodies()
    expect(searched.plugins).toEqual([{ id: 'web', max_results: 5 }])
    expect(searched.web_search_options).toEqual({ search_context_size: 'low' })
    expect(plain.plugins).toBeUndefined()
    expect(plain.web_search_options).toBeUndefined()
  })

  // Production, 2026-10-10: openai/gpt-4o answered every request carrying
  // web_search_options with a 400. OpenAI accepts it only on *-search-preview.
  it('sends OpenAI models the web plugin without web_search_options', async () => {
    await callOpenRouterWithEvidence({ label: 'pulse.platform', model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'Q' }], webSearch: true })
    const [body] = bodies()
    expect(body.plugins).toEqual([{ id: 'web', max_results: 5 }])
    expect(body).not.toHaveProperty('web_search_options')
  })
})

describe('callMultiPlatform', () => {
  it('sends each platform its own answer limit when given one per platform', async () => {
    await callMultiPlatform([{ role: 'user', content: 'Q' }], p => (p === 'gemini-flash' ? 4000 : 1500), ['gemini-flash', 'gpt-4o'])
    const byModel = Object.fromEntries(bodies().map(b => [b.model, b]))
    expect(byModel['google/gemini-3.8-flash'].max_tokens).toBe(4000)
    expect(byModel['openai/gpt-4o'].max_tokens).toBe(1500)
    expect(byModel['google/gemini-3.8-flash']).not.toHaveProperty('reasoning')
  })

  it('asks only platforms that do not search natively to search, and returns citations and grounding', async () => {
    const results = await callMultiPlatform([{ role: 'user', content: 'Q' }], 500, ['perplexity-sonar', 'gpt-4o'], undefined, { webSearch: true })
    const byModel = Object.fromEntries(bodies().map(b => [b.model, b]))
    expect(byModel['perplexity/sonar'].plugins).toBeUndefined()
    expect(byModel['openai/gpt-4o'].plugins).toEqual([{ id: 'web', max_results: 5 }])
    expect(results).toMatchObject([
      { platform: 'perplexity-sonar', answer: 'An answer.', grounding: 'native', providerCitations: [{ url: 'https://hsbc.com.hk/', title: 'HSBC' }] },
      { platform: 'gpt-4o', answer: 'An answer.', grounding: 'web', providerCitations: [{ url: 'https://hsbc.com.hk/', title: 'HSBC' }] },
    ])
  })

  it('never searches when web search is not allowed, and says so', async () => {
    const [result] = await callMultiPlatform([{ role: 'user', content: 'Q' }], 500, ['claude-haiku'])
    expect(bodies()[0].plugins).toBeUndefined()
    expect(result.grounding).toBe('none')
  })
})
