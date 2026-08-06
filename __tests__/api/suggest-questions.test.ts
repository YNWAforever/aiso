import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<{ text: string; params: unknown[] }> = []
let clientRows: unknown[]
let existingRows: unknown[]
let lookupFails = false

const mockSql = vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => {
  const text = strings.join('?')
  calls.push({ text, params })
  if (lookupFails) return Promise.reject(new Error('boom'))
  if (/from clients/i.test(text)) return Promise.resolve(clientRows)
  return Promise.resolve(existingRows)
})
vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

const llm = vi.hoisted(() => ({ callOpenRouter: vi.fn() }))
vi.mock('@/lib/openrouter', () => llm)

import { POST } from '@/app/api/pulse/suggest-questions/route'
import { getProfile } from '@/lib/auth'

function account(plan: string, extra: Record<string, unknown> = {}) {
  return {
    account_id: 'acc-1',
    accounts: { plan, status: 'active', stripe_subscription_id: 'sub_1', ...extra },
  }
}

const post = (body: unknown = { clientId: 'client-1' }) =>
  POST(new Request('http://localhost/api/pulse/suggest-questions', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never)

beforeEach(() => {
  calls.length = 0
  lookupFails = false
  clientRows = [{ brand_name: 'AcmeCo', industry: 'technology' }]
  existingRows = [{ question: 'What is AcmeCo?' }]
  vi.mocked(getProfile).mockReset()
  vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
  llm.callOpenRouter.mockReset()
  llm.callOpenRouter.mockResolvedValue(JSON.stringify([
    { question: 'How does AcmeCo compare?', category: 'category_query' },
    { question: 'Why choose AcmeCo?', category: 'brand_query' },
  ]))
})

describe('POST /api/pulse/suggest-questions — gating', () => {
  it('returns 401 and spends nothing when unauthenticated', async () => {
    vi.mocked(getProfile).mockResolvedValue(null as never)
    const res = await post()

    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
    expect(llm.callOpenRouter).not.toHaveBeenCalled()
  })

  it.each(['free', 'basic'])('refuses %s before any LLM spend', async (plan) => {
    // The gap this closes: pre-fence the route was auth-only, so any signed-in
    // user could burn OpenRouter budget — and a suggestion is useless without
    // the write endpoint, which requires the same flag.
    vi.mocked(getProfile).mockResolvedValue(account(plan) as never)
    const res = await post()

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'UPGRADE_REQUIRED', feature: 'edit_prompts' })
    expect(calls).toHaveLength(0)
    expect(llm.callOpenRouter).not.toHaveBeenCalled()
  })

  it('refuses a cancelled account still carrying plan=pro', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro', { status: 'cancelled' }) as never)

    expect((await post()).status).toBe(403)
  })

  it('returns 404 for another account\'s brand, without calling the model', async () => {
    clientRows = []
    const res = await post()

    expect(res.status).toBe(404)
    expect(llm.callOpenRouter).not.toHaveBeenCalled()
  })

  it('returns 503, not 404, when the lookup itself fails', async () => {
    // The pre-fence helper caught this and returned false, so a database
    // incident read as "no such client".
    lookupFails = true

    expect((await post()).status).toBe(503)
  })

  it('scopes the client lookup by account', async () => {
    await post()

    expect(calls[0].params).toEqual(['client-1', 'acc-1'])
  })
})

describe('POST /api/pulse/suggest-questions — generation', () => {
  it('returns 400 without a clientId', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post('not json')).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('feeds the existing questions back so suggestions are new', async () => {
    await post()
    const prompt = llm.callOpenRouter.mock.calls[0][0].messages[0].content

    expect(prompt).toContain('do NOT repeat these')
    expect(prompt).toContain('What is AcmeCo?')
  })

  it('clamps the count rather than trusting the body', async () => {
    for (const [asked, expected] of [[99, 10], [0, 1], [-4, 1], ['abc', 5]] as const) {
      llm.callOpenRouter.mockClear()
      await post({ clientId: 'client-1', count: asked })
      const prompt = llm.callOpenRouter.mock.calls[0][0].messages[0].content
      expect(prompt).toContain(`Generate ${expected} NEW`)
    }
  })

  it('drops a suggestion whose category is outside the vocabulary', async () => {
    // Otherwise the user accepts it and the write endpoint 400s — a dead end
    // presented as a valid option.
    llm.callOpenRouter.mockResolvedValue(JSON.stringify([
      { question: 'Kept?', category: 'brand_query' },
      { question: 'Invented', category: 'competitor_query' },
      { question: 'Label', category: 'Brand Queries' },
    ]))
    const { suggestions } = await (await post()).json()

    expect(suggestions).toEqual([{ question: 'Kept?', category: 'brand_query' }])
  })

  it('drops a suggestion with no usable question', async () => {
    llm.callOpenRouter.mockResolvedValue(JSON.stringify([
      { question: '   ', category: 'brand_query' },
      { category: 'brand_query' },
    ]))

    expect((await (await post()).json()).suggestions).toEqual([])
  })

  it('returns an empty list rather than 500 when the model reply is unusable', async () => {
    for (const reply of ['not json at all', '{"nope":1}', '']) {
      llm.callOpenRouter.mockResolvedValue(reply)
      const res = await post()

      expect(res.status).toBe(200)
      expect((await res.json()).suggestions).toEqual([])
    }
  })

  it('survives the model call failing outright', async () => {
    llm.callOpenRouter.mockRejectedValue(new Error('rate limited'))
    const res = await post()

    expect(res.status).toBe(200)
    expect((await res.json()).suggestions).toEqual([])
  })

  it('writes nothing — suggestions are for review, not for saving', async () => {
    await post()

    expect(calls.some(c => /insert|update|delete/i.test(c.text))).toBe(false)
  })
})
