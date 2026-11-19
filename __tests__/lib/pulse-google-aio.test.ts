import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LeasedItem } from '@/lib/pulse/runs/schema'

const request = vi.hoisted(() => vi.fn())
const commit = vi.hoisted(() => vi.fn(async () => 'committed'))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/openrouter', () => ({ callOpenRouterWithEvidence: request, modelVariantsFor: vi.fn(() => []) }))
vi.mock('@/lib/pulse/runs/store', () => ({ commitAttempt: commit }))

import { processLeasedItem } from '@/lib/pulse/runs/service'
import { collectGoogleAio, GOOGLE_AIO_ABSENT_ANSWER, GoogleAioUnconfiguredError } from '@/lib/pulse/google-aio'

const env = { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'c' }
const serp = (items: unknown[]) => new Response(JSON.stringify({ tasks: [{ status_code: 20000, result: [{ items }] }] }))

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); request.mockReset(); commit.mockClear() })

describe('collectGoogleAio', () => {
  it('returns the overview text and safe sources as native-grounded evidence', async () => {
    const fetchImpl = vi.fn(async () => serp([{ type: 'ai_overview', text: 'AcmeCo 是熱門選擇。', references: [
      { url: 'https://acme.test/a', title: 'Acme' }, { url: 'http://127.0.0.1/x' },
    ] }]))
    const evidence = await collectGoogleAio('最好的工具？', undefined, env, fetchImpl as never)
    expect(evidence).toMatchObject({
      answer: 'AcmeCo 是熱門選擇。', grounding: 'native', providerFinishReason: 'present',
      actualModel: 'dataforseo/google-ai-overview', providerCitations: [{ url: 'https://acme.test/a', title: 'Acme' }],
    })
  })

  it('records "no AI Overview" as a non-blank answer that names no brand, so it is classified, not re-collected', async () => {
    const evidence = await collectGoogleAio('q', undefined, env, (async () => serp([{ type: 'organic' }])) as never)
    expect(evidence.answer).toBe(GOOGLE_AIO_ABSENT_ANSWER)
    expect(evidence.answer.trim()).not.toBe('')
    expect(evidence.providerFinishReason).toBe('absent')
    expect(evidence.providerCitations).toBeNull()
  })

  it('throws on a failed request and when credentials are missing, never inventing an answer', async () => {
    await expect(collectGoogleAio('q', undefined, env, (async () => new Response('', { status: 500 })) as never)).rejects.toThrow('google_aio_http')
    await expect(collectGoogleAio('q', undefined, {}, vi.fn() as never)).rejects.toBeInstanceOf(GoogleAioUnconfiguredError)
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
    expect(fetchMock).not.toHaveBeenCalled()
    const answers = await callMultiPlatform(messages, 100, ['google-aio'], undefined, { question: 'raw question?' })
    expect(answers).toEqual([expect.objectContaining({ platform: 'google-aio', answer: 'AIO answer', grounding: 'native', requestedModel: 'dataforseo/google-ai-overview' })])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))[0].keyword).toBe('raw question?')
  })
})
