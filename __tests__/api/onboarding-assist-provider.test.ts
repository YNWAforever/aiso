import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/onboarding/assist/route'

const { fetchPage } = vi.hoisted(() => ({ fetchPage: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: async () => ({ account_id: 'tenant-a' }) }))
vi.mock('@/lib/onboarding/assistant-limit', () => ({
  ASSISTANT_LIMIT: 5,
  consumeAssistantLimit: async () => ({ allowed: true, remaining: 4, resetAt: 2_000_000_000 }),
}))
// Replace only external boundaries: use the real generator, serializer and route.
vi.mock('@/lib/security/public-url', () => ({ createPublicUrlFetcher: () => fetchPage }))

const pageText = 'Example Workshop teaches design. Design lessons for adults.'
const value = {
  brandName: 'Example Workshop', description: 'Design lessons for adults.', industry: null,
  evidence: [
    { field: 'brandName', quote: 'Example Workshop' },
    { field: 'description', quote: 'Design lessons for adults.' },
  ],
}
async function post(language = 'zh-HK') {
  return POST(new NextRequest('http://localhost/api/onboarding/assist', {
    method: 'POST', body: JSON.stringify({ url: 'https://example.com/', language, market: 'HK' }),
  }))
}
function completion(content: unknown = value) {
  return new Response(JSON.stringify({
    id: 'gen-fixture', model: 'anthropic/claude-haiku-4.5',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
  }))
}
beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-provider-secret')
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchPage.mockResolvedValue(new Response(`<html><body>${pageText}</body></html>`, {
    headers: { 'content-type': 'text/html' },
  }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('onboarding assistant provider request', () => {
  it('uses the canonical OpenRouter Haiku model', async () => {
    const request = vi.fn().mockResolvedValue(completion())
    vi.stubGlobal('fetch', request)
    expect((await post()).status).toBe(200)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
      model: 'anthropic/claude-haiku-4.5', max_tokens: 700,
      provider: { require_parameters: true },
      response_format: { type: 'json_schema', json_schema: { name: 'brand_draft', strict: true } },
    })
  })

  it('sends a schema compatible with Anthropic structured outputs', async () => {
    const request = vi.fn().mockResolvedValue(completion())
    vi.stubGlobal('fetch', request)
    await post()
    const payload = JSON.parse(request.mock.calls[0][1].body)
    // These constraints are rejected by the upstream grammar compiler with 400.
    // Their bounds remain enforced by validateBrandEvidence on the server.
    const schema = JSON.stringify(payload.response_format.json_schema.schema)
    for (const keyword of ['minLength', 'maxLength', 'maxItems']) expect(schema).not.toContain(`"${keyword}"`)
    expect(payload.response_format.json_schema.schema.properties.industry).toMatchObject({ type: ['string', 'null'] })
    expect(JSON.parse(payload.messages[1].content)).toEqual({ language: 'zh-HK', market: 'HK', source: 'https://example.com/', pageText })
  })

  it.each(['en', 'zh-HK'])('returns a reviewable evidence-backed draft (%s)', async language => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion()))
    const response = await post(language)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ ...value, domain: 'example.com', language, market: 'HK', reviewRequired: true })
  })

  it('keeps evidence bounds after removing upstream schema constraints', async () => {
    fetchPage.mockResolvedValue(new Response(`<html><body>${pageText} ${'x'.repeat(241)}</body></html>`, {
      headers: { 'content-type': 'text/html' },
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ ...value, evidence: [
      { field: 'industry', quote: '' }, { field: 'industry', quote: 'x'.repeat(241) },
      ...Array.from({ length: 9 }, (_, i) => ({ field: 'brandName', quote: pageText.slice(0, 10 + i) })),
    ] })))
    const response = await post()
    const draft = await response.json()
    expect(draft.evidence).toHaveLength(6)
    expect(draft.evidence.every((item: { quote: string }) => item.quote.length > 0 && item.quote.length <= 240)).toBe(true)
    expect(draft.description).toBe('')
    expect(draft.industry).toBeNull()
  })

  it('returns only the safe error when the real provider boundary fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: 400, message: 'Provider returned error', metadata: { raw: `synthetic-provider-secret ${pageText}` },
    } }), { status: 400 })))
    const response = await post()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'ASSISTANT_UNAVAILABLE' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
