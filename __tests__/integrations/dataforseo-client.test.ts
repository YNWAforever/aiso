import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DATAFORSEO_SERP_URL,
  buildSerpRequestBody,
  classifyDataForSeoFailure,
  dataForSeoConfig,
  liveGoogleOrganicAdvanced,
} from '@/lib/integrations/dataforseo/client'
import { DataForSeoError } from '@/lib/integrations/dataforseo/types'

vi.mock('server-only', () => ({}))

const env = {
  DATAFORSEO_LOGIN: 'fixture-login',
  DATAFORSEO_PASSWORD: 'UNIT_TEST_CREDENTIAL',
}
const input = { keyword: 'sourdough hong kong', locationCode: 2344, languageCode: 'zh-TW' }

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.restoreAllMocks())

describe('dataForSeoConfig', () => {
  it('uses the Hong Kong and Traditional Chinese defaults', () => {
    expect(dataForSeoConfig(env)).toEqual({
      login: 'fixture-login', credential: 'UNIT_TEST_CREDENTIAL', locationCode: 2344, languageCode: 'zh-TW',
    })
  })

  it('treats missing or blank credentials as unavailable', () => {
    expect(dataForSeoConfig({})).toBeNull()
    expect(dataForSeoConfig({ DATAFORSEO_LOGIN: ' ', DATAFORSEO_PASSWORD: 'x' })).toBeNull()
  })
})

describe('liveGoogleOrganicAdvanced', () => {
  it('POSTs exactly one Live Advanced task with depth 10 and Basic auth', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      status_code: 20000, status_message: 'Ok',
      tasks: [{ status_code: 20000, result: [{ items: [
        { type: 'organic', rank_group: 1, rank_absolute: 1, domain: 'example.com', title: 'Example', url: 'https://example.com/a' },
        { type: 'organic', rank_group: 2, rank_absolute: 2, domain: 'example.org', title: 'Other', url: 'https://example.org/b' },
      ] }] }],
    }))
    const result = await liveGoogleOrganicAdvanced(input, env, fetchImpl)
    expect(result.items).toEqual([
      { rank: 1, title: 'Example', url: 'https://example.com/a', domain: 'example.com' },
      { rank: 2, title: 'Other', url: 'https://example.org/b', domain: 'example.org' },
    ])
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(DATAFORSEO_SERP_URL)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toMatch(/^Basic /)
    expect(JSON.parse(init.body)).toEqual({ tasks: [{
      keyword: 'sourdough hong kong', location_code: 2344, language_code: 'zh-TW',
      depth: 10, load_async_ai_overview: false,
    }] })
    expect(init.body).not.toContain('UNIT_TEST_CREDENTIAL')
  })

  it('keeps only organic rows with a numeric vendor rank', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ items: [
        { type: 'featured_snippet', rank_group: 0, rank_absolute: 0, title: 'Snippet', url: 'https://snippet.example' },
        { type: 'people_also_ask', title: 'Question', url: 'https://question.example' },
        { type: 'organic', title: 'No rank', url: 'https://norank.example' },
        { type: 'organic', rank_group: '2', title: 'String rank', url: 'https://string.example' },
        { type: 'organic', rank_group: 7, title: 'Grouped', url: 'https://grouped.example' },
        { type: 'organic', rank_absolute: 3, rank_group: 5, domain: 'example.com', title: 'Absolute', url: 'https://example.com/a' },
      ] }] }],
    }))
    expect((await liveGoogleOrganicAdvanced(input, env, fetchImpl)).items).toEqual([
      { rank: 7, title: 'Grouped', url: 'https://grouped.example' },
      { rank: 3, title: 'Absolute', url: 'https://example.com/a', domain: 'example.com' },
    ])
  })

  it('does not fetch when credentials are missing', async () => {
    const fetchImpl = vi.fn()
    await expect(liveGoogleOrganicAdvanced(input, {}, fetchImpl)).rejects.toMatchObject({ kind: 'misconfigured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects empty or multi-task request arrays', () => {
    expect(() => buildSerpRequestBody([])).toThrow(DataForSeoError)
    expect(() => buildSerpRequestBody([{}, {}])).toThrow(DataForSeoError)
  })

  it.each([
    [401, undefined, 'auth'], [402, undefined, 'payment'], [429, undefined, 'rate_limit'],
    [500, undefined, 'unavailable'], [400, undefined, 'invalid'],
    [200, 40104, 'auth'], [200, 40200, 'payment'], [200, 42900, 'rate_limit'],
    [200, 50000, 'unavailable'], [200, 40400, 'invalid'],
  ] as const)('classifies HTTP %s / vendor %s as %s', (http, code, kind) => {
    expect(classifyDataForSeoFailure(http, code)).toBe(kind)
  })

  it('maps vendor task failures without logging the credential', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ status_code: 20000, tasks: [{ status_code: 40104, status_message: 'Auth failed' }] }))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(liveGoogleOrganicAdvanced(input, env, fetchImpl)).rejects.toMatchObject({ kind: 'auth', code: 40104 })
    const logged = [...consoleError.mock.calls, ...consoleLog.mock.calls].flat().join(' ')
    expect(logged).not.toContain('UNIT_TEST_CREDENTIAL')
  })

  it('returns an empty item list for an OK response with no organic rows', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [] }] }] }))
    expect((await liveGoogleOrganicAdvanced(input, env, fetchImpl)).items).toEqual([])
  })
})
