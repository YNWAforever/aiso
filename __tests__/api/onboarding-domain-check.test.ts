import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { profile, limit, check } = vi.hoisted(() => ({ profile: vi.fn(), limit: vi.fn(), check: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: profile }))
vi.mock('@/lib/onboarding/domain-check-limit', () => ({ consumeDomainCheckLimit: limit, DOMAIN_CHECK_LIMIT: 20 }))
vi.mock('@/lib/onboarding/domain-check', async importOriginal => ({ ...await importOriginal<object>(), checkPublicHomepage: check }))

async function post(body: unknown = { url: 'example.com' }) {
  const { POST } = await import('@/app/api/onboarding/domain-check/route')
  return POST(new NextRequest('http://localhost/api/onboarding/domain-check', { method: 'POST', body: JSON.stringify(body) }))
}
beforeEach(() => {
  vi.clearAllMocks()
  profile.mockResolvedValue({ account_id: 'tenant-a' })
  limit.mockResolvedValue({ allowed: true, remaining: 19, resetAt: 2_000_000_000 })
  check.mockResolvedValue({ status: 'live', domain: 'example.com', pageTitle: 'Example' })
})
describe('onboarding domain check API', () => {
  it('denies anonymous callers before any fetch or quota work', async () => {
    profile.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(check).not.toHaveBeenCalled(); expect(limit).not.toHaveBeenCalled()
  })
  it('rejects malformed input without consuming allowance', async () => {
    expect((await post({ url: 'http://localhost' })).status).toBe(400)
    expect(limit).not.toHaveBeenCalled()
  })
  it('uses the session account, not a body account ID', async () => {
    expect((await post({ url: 'example.com', accountId: 'tenant-b' })).status).toBe(200)
    expect(limit).toHaveBeenCalledWith('tenant-a')
  })
  it('blocks excess work with retry headers', async () => {
    limit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 2_000_000_000 })
    const response = await post()
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeTruthy()
    expect(check).not.toHaveBeenCalled()
  })
  it('fails closed if the quota store is unavailable', async () => {
    limit.mockRejectedValue(new Error('database unavailable'))
    expect((await post()).status).toBe(503)
    expect(check).not.toHaveBeenCalled()
  })
  it('returns a safe failure instead of raw fetch errors', async () => {
    check.mockRejectedValue(new Error('token=secret'))
    const response = await post()
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('secret')
  })
  it('returns the result and never caches it', async () => {
    const response = await post()
    expect(await response.json()).toEqual({ status: 'live', domain: 'example.com', pageTitle: 'Example' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
