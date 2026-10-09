import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The paid AI content tools. Each call is an OpenRouter request (Sonnet for
 * content-brief and cluster-map) and content-brief also writes a row, yet all
 * four routes checked only that a session existed: a free or cancelled account
 * could call them in a loop. pulse/suggest-questions documents and fixed the
 * same hole; these now share one guard (auth → plan → ownership → allowance).
 */

const h = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  consume: vi.fn(),
  llm: vi.fn(),
  owns: true,
  cachedFixPack: false,
}))

vi.mock('@/lib/auth', () => ({ getProfile: vi.fn(async () => h.profile) }))
vi.mock('@/lib/openrouter', () => ({ callOpenRouter: h.llm }))
vi.mock('@/lib/security/durable-rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/security/durable-rate-limit')>()),
  consumeFromNeon: h.consume,
  resolveRateLimitSecret: () => 'x'.repeat(32),
}))
vi.mock('@/lib/db', () => ({
  db: () => (strings: TemplateStringsArray) => {
    const text = strings.join('?').toLowerCase()
    if (text.includes('from clients')) return Promise.resolve(h.owns ? [{ id: 'client-1' }] : [])
    if (text.includes('from fix_packs')) {
      return Promise.resolve(h.cachedFixPack ? [{ llms_txt: 'x', robots_patch: 'y', faq_schema: '{}' }] : [])
    }
    if (text.includes('from scans')) return Promise.resolve(h.owns ? [{ id: 'scan-1', url: 'https://example.com', domain: 'example.com', results: {} }] : [])
    return Promise.resolve([])
  },
}))
vi.mock('@/lib/security/public-url', () => ({
  PublicUrlError: class extends Error {},
  fetchPublicUrl: vi.fn(async () => new Response('<html></html>')),
}))

const account = (plan: string, extra: Record<string, unknown> = {}) => ({
  plan, status: 'active', stripe_subscription_id: 'sub_1',
  trial_ends_at: null, override_plan: null, override_expires_at: null, ...extra,
})
const signedIn = (accounts: Record<string, unknown>) => ({ id: 'p1', account_id: 'acct-1', accounts })

const ROUTES = [
  ['content-brief', '@/app/api/fix/content-brief/route', { clientId: 'client-1', targetTopic: 'x', industry: 'technology' }],
  ['cluster-map', '@/app/api/fix/cluster-map/route', { clientId: 'client-1', industry: 'technology' }],
  ['rewrite-chunks', '@/app/api/fix/rewrite-chunks/route', { chunkText: 'Some text.', heading: 'H' }],
] as const

async function call(modulePath: string, body: unknown) {
  const { POST } = await import(modulePath)
  return POST(new NextRequest('http://localhost/api/fix/x', { method: 'POST', body: JSON.stringify(body) })) as Promise<Response>
}

beforeEach(() => {
  h.profile = signedIn(account('pro'))
  h.owns = true
  h.cachedFixPack = false
  h.consume.mockReset()
  h.consume.mockResolvedValue({ allowed: true, remaining: 19, resetAt: 2_000_000_000 })
  h.llm.mockReset()
  h.llm.mockResolvedValue('{}')
})

describe.each(ROUTES)('POST /api/fix/%s', (_name, modulePath, body) => {
  it.each([
    ['free', account('free', { stripe_subscription_id: null })],
    ['cancelled', account('pro', { status: 'cancelled' })],
    ['expired trial', account('basic', { status: 'trialing', stripe_subscription_id: null, trial_ends_at: '2026-01-01T00:00:00Z' })],
  ])('refuses a %s account before any LLM spend', async (_label, accounts) => {
    h.profile = signedIn(accounts)
    const res = await call(modulePath, body)

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'UPGRADE_REQUIRED' })
    expect(h.llm).not.toHaveBeenCalled()
    expect(h.consume).not.toHaveBeenCalled()
  })

  it('refuses a paid account over its daily allowance before any LLM spend', async () => {
    h.consume.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 2_000_000_000 })
    const res = await call(modulePath, body)

    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ error: 'AI_TOOL_LIMIT_REACHED' })
    expect(h.llm).not.toHaveBeenCalled()
  })

  it('fails closed when the allowance cannot be checked', async () => {
    h.consume.mockRejectedValue(new Error('counter down'))
    const res = await call(modulePath, body)

    expect(res.status).toBe(503)
    expect(h.llm).not.toHaveBeenCalled()
  })

  it('spends one allowance unit and calls the model for a paid account', async () => {
    await call(modulePath, body)

    expect(h.consume).toHaveBeenCalledTimes(1)
    expect(h.llm).toHaveBeenCalled()
  })
})

describe('allowance is keyed to the account', () => {
  it('derives the counter key from the account, not the caller address', async () => {
    await call('@/app/api/fix/rewrite-chunks/route', { chunkText: 'x' })
    h.profile = { ...signedIn(account('pro')), account_id: 'acct-2' }
    await call('@/app/api/fix/rewrite-chunks/route', { chunkText: 'x' })

    const [first, second] = h.consume.mock.calls.map(c => c[0])
    expect(first).not.toBe(second)
  })

  it('does not spend allowance on a client the caller does not own', async () => {
    h.owns = false
    const res = await call('@/app/api/fix/content-brief/route', ROUTES[0][2])

    expect(res.status).toBe(404)
    expect(h.consume).not.toHaveBeenCalled()
  })
})

describe('POST /api/fix (Fix Pack)', () => {
  it('spends allowance only when it has to generate', async () => {
    h.cachedFixPack = true
    await call('@/app/api/fix/route', { scanId: 'scan-1' })

    expect(h.consume).not.toHaveBeenCalled()
    expect(h.llm).not.toHaveBeenCalled()
  })

  it('refuses a cache miss over the allowance before any LLM spend', async () => {
    h.consume.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 2_000_000_000 })
    const res = await call('@/app/api/fix/route', { scanId: 'scan-1' })

    expect(res.status).toBe(429)
    expect(h.llm).not.toHaveBeenCalled()
  })
})
