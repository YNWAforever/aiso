import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { profile, limit, generate } = vi.hoisted(() => ({ profile: vi.fn(), limit: vi.fn(), generate: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: profile }))
vi.mock('@/lib/onboarding/assistant-limit', () => ({ consumeAssistantLimit: limit, ASSISTANT_LIMIT: 5 }))
vi.mock('@/lib/onboarding/brand-assistant', async importOriginal => ({ ...await importOriginal<object>(), generateBrandDraft: generate }))

async function post(body: unknown = { url: 'example.com', language: 'en', market: 'HK' }) {
  const { POST } = await import('@/app/api/onboarding/assist/route')
  return POST(new NextRequest('http://localhost/api/onboarding/assist', { method: 'POST', body: JSON.stringify(body) }))
}
beforeEach(() => { vi.clearAllMocks(); profile.mockResolvedValue({ account_id: 'tenant-a' }); limit.mockResolvedValue({ allowed: true, remaining: 4, resetAt: 2_000_000_000 }); generate.mockResolvedValue({ brandName: 'Example' }) })
describe('onboarding assistance API', () => {
  it('denies anonymous callers before any paid work', async () => { profile.mockResolvedValue(null); expect((await post()).status).toBe(401); expect(generate).not.toHaveBeenCalled(); expect(limit).not.toHaveBeenCalled() })
  it('rejects malformed input without consuming allowance', async () => { expect((await post({ url: 'example.com' })).status).toBe(400); expect(limit).not.toHaveBeenCalled() })
  it('uses the session account, not a body account ID', async () => { expect((await post({ url: 'example.com', language: 'en', market: 'HK', accountId: 'tenant-b' })).status).toBe(200); expect(limit).toHaveBeenCalledWith('tenant-a') })
  it('blocks excess work with retry headers', async () => { limit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 2_000_000_000 }); const r = await post(); expect(r.status).toBe(429); expect(r.headers.get('retry-after')).toBeTruthy(); expect(generate).not.toHaveBeenCalled() })
  it('fails closed if the quota store is unavailable', async () => { limit.mockRejectedValue(new Error('database unavailable')); expect((await post()).status).toBe(503); expect(generate).not.toHaveBeenCalled() })
  it('returns a safe failure instead of raw provider errors or empty success', async () => { generate.mockRejectedValue(new Error('token=secret')); const r = await post(); expect(r.status).toBe(503); expect(await r.text()).not.toContain('secret') })
  it('never caches brand drafts', async () => { expect((await post()).headers.get('cache-control')).toBe('no-store') })
})
