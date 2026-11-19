import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LeasedItem } from '@/lib/pulse/runs/schema'

const request = vi.hoisted(() => vi.fn())
const commit = vi.hoisted(() => vi.fn(async () => 'committed'))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/openrouter', () => ({ callOpenRouterWithEvidence: request, modelVariantsFor: vi.fn(() => []) }))
vi.mock('@/lib/pulse/runs/store', () => ({ commitAttempt: commit }))

import { processLeasedItem } from '@/lib/pulse/runs/service'
import { collectGoogleAio, GOOGLE_AIO_ABSENT_ANSWER, GoogleAioUnconfiguredError, GoogleAioUnsupportedMarketError, googleAioMarket } from '@/lib/pulse/google-aio'

const env = { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'c' }
const HK = { language: 'zh-HK', market: 'HK' }
const serp = (items: unknown[]) => new Response(JSON.stringify({ tasks: [{ status_code: 20000, result: [{ items }] }] }))

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); request.mockReset(); commit.mockClear() })

describe('collectGoogleAio', () => {
  it('returns the overview text and safe sources as native-grounded evidence', async () => {
    const fetchImpl = vi.fn(async () => serp([{ type: 'ai_overview', text: 'AcmeCo 是熱門選擇。', references: [
      { url: 'https://acme.test/a', title: 'Acme' }, { url: 'http://127.0.0.1/x' },
    ] }]))
    const evidence = await collectGoogleAio('最好的工具？', HK, undefined, env, fetchImpl as never)
    expect(evidence).toMatchObject({
      answer: 'AcmeCo 是熱門選擇。', grounding: 'native', providerFinishReason: 'present',
      actualModel: 'dataforseo/google-ai-overview', providerCitations: [{ url: 'https://acme.test/a', title: 'Acme' }],
    })
  })

  it('records "no AI Overview" as a non-blank answer that names no brand, so it is classified, not re-collected', async () => {
    const evidence = await collectGoogleAio('q', HK, undefined, env, (async () => serp([{ type: 'organic' }])) as never)
    expect(evidence.answer).toBe(GOOGLE_AIO_ABSENT_ANSWER)
    expect(evidence.answer.trim()).not.toBe('')
    expect(evidence.providerFinishReason).toBe('absent')
    expect(evidence.providerCitations).toBeNull()
  })

  it('throws on a failed request and when credentials are missing, never inventing an answer', async () => {
    await expect(collectGoogleAio('q', HK, undefined, env, (async () => new Response('', { status: 500 })) as never)).rejects.toThrow('google_aio_http')
    await expect(collectGoogleAio('q', HK, undefined, {}, vi.fn() as never)).rejects.toBeInstanceOf(GoogleAioUnconfiguredError)
  })
})

describe('prompt market and language', () => {
  it('searches each prompt in its own market and language', async () => {
    expect(googleAioMarket({ language: 'zh-HK', market: 'HK' })).toEqual({ locationCode: 2344, languageCode: 'zh-TW' })
    expect(googleAioMarket({ language: 'en', market: 'US' })).toEqual({ locationCode: 2840, languageCode: 'en' })
    const fetchImpl = vi.fn(async () => serp([{ type: 'organic' }]))
    await collectGoogleAio('best crm?', { language: 'en', market: 'US' }, undefined, env, fetchImpl as never)
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body))[0]).toMatchObject({ location_code: 2840, language_code: 'en' })
  })

  it('refuses markets with no single Google search market, without a request', async () => {
    for (const market of ['EU', 'global', null]) expect(googleAioMarket({ language: 'en', market })).toBeNull()
    const fetchImpl = vi.fn()
    await expect(collectGoogleAio('q', { language: 'en', market: 'EU' }, undefined, env, fetchImpl as never)).rejects.toBeInstanceOf(GoogleAioUnsupportedMarketError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('the run ledger collector', () => {
  const item = { platform: 'google-aio', model: 'dataforseo/google-ai-overview', snapshot: { question: '香港最好的 SEO 工具？', language: 'zh-HK', market: 'HK' } } as unknown as LeasedItem

  it('blocks google-aio without DataForSEO credentials instead of spending or failing', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic')
    vi.stubEnv('DATAFORSEO_LOGIN', '')
    await processLeasedItem(item, Date.now() + 45_000)
    expect(commit).toHaveBeenCalledWith(item, { kind: 'blocked', errorCode: 'PROVIDER_NOT_CONFIGURED' })
    expect(request).not.toHaveBeenCalled()
  })

  it('blocks an EU / Global prompt permanently instead of searching another market', async () => {
    vi.stubEnv('DATAFORSEO_LOGIN', 'l'); vi.stubEnv('DATAFORSEO_PASSWORD', 'c')
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    const eu = { ...item, snapshot: { ...item.snapshot, language: 'en', market: 'EU' } } as unknown as LeasedItem
    await processLeasedItem(eu, Date.now() + 45_000)
    expect(commit).toHaveBeenCalledWith(eu, { kind: 'blocked', errorCode: 'PROVIDER_MARKET_UNSUPPORTED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('looks the raw question up on Google, not through OpenRouter', async () => {
    vi.stubEnv('DATAFORSEO_LOGIN', 'l'); vi.stubEnv('DATAFORSEO_PASSWORD', 'c')
    const fetchMock = vi.fn(async () => serp([{ type: 'ai_overview', text: 'Overview text' }]))
    vi.stubGlobal('fetch', fetchMock)
    await processLeasedItem(item, Date.now() + 45_000)
    expect(request).not.toHaveBeenCalled()
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))[0].keyword).toBe('香港最好的 SEO 工具？')
    expect(commit).toHaveBeenCalledWith(item, { kind: 'succeeded', evidence: expect.objectContaining({ answer: 'Overview text', grounding: 'native' }) })
  })
})

describe('callMultiPlatform (classic producer)', () => {
  it('collects google-aio from DataForSEO only when given the raw question, never from OpenRouter', async () => {
    vi.resetModules()
    vi.doUnmock('@/lib/openrouter')
    const { callMultiPlatform } = await import('@/lib/openrouter')
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic'); vi.stubEnv('DATAFORSEO_LOGIN', 'l'); vi.stubEnv('DATAFORSEO_PASSWORD', 'c')
    const fetchMock = vi.fn(async (url: string) => {
      if (!String(url).includes('dataforseo')) throw new Error(`unexpected request to ${url}`)
      return serp([{ type: 'ai_overview', text: 'AIO answer' }])
    })
    vi.stubGlobal('fetch', fetchMock)
    const messages = [{ role: 'user' as const, content: 'wrapped prompt' }]
    expect(await callMultiPlatform(messages, 100, ['google-aio'])).toEqual([])
    expect(await callMultiPlatform(messages, 100, ['google-aio'], undefined, { question: 'raw question?' })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    const answers = await callMultiPlatform(messages, 100, ['google-aio'], undefined, { question: 'raw question?', context: { language: 'zh-HK', market: 'HK' } })
    expect(answers).toEqual([expect.objectContaining({ platform: 'google-aio', answer: 'AIO answer', grounding: 'native', requestedModel: 'dataforseo/google-ai-overview' })])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))[0].keyword).toBe('raw question?')
  })
})

describe('unblockConfiguredItems', () => {
  it('re-queues only items whose own provider is configured', async () => {
    vi.resetModules()
    const calls: unknown[][] = []
    vi.doMock('@/lib/db', () => ({ db: () => (_s: TemplateStringsArray, ...params: unknown[]) => { calls.push(params); return Promise.resolve([]) } }))
    vi.doUnmock('@/lib/openrouter')
    const { unblockConfiguredItems } = await import('@/lib/pulse/runs/queue')
    const run = { id: 'r', accountId: 'a', clientId: 'c', allowedPlatforms: ['gemini-flash', 'google-aio'] } as never
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic'); vi.stubEnv('DATAFORSEO_LOGIN', '')
    await unblockConfiguredItems(run)
    expect(calls.at(-1)).toContainEqual(['google/gemini-3.8-flash'])
    vi.stubEnv('OPENROUTER_API_KEY', ''); vi.stubEnv('DATAFORSEO_LOGIN', 'l'); vi.stubEnv('DATAFORSEO_PASSWORD', 'c')
    await unblockConfiguredItems(run)
    expect(calls.at(-1)).toContainEqual(['dataforseo/google-ai-overview'])
    vi.stubEnv('DATAFORSEO_LOGIN', '')
    const before = calls.length
    await unblockConfiguredItems(run)
    expect(calls.length).toBe(before)
  })
})
