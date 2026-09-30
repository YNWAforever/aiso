import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProfile = vi.hoisted(() => vi.fn())
const verifyClientOwnership = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/localTrust/store', () => ({ verifyClientOwnership }))

import { authorizeAnalytics } from '@/lib/integrations/analytics/guard'

const pro = { id: 'p', account_id: 'a', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }
const CLIENT_ID = '11111111-1111-1111-1111-111111111111'
const status = async (clientId = CLIENT_ID) => {
  const r = await authorizeAnalytics(clientId)
  return r.ok ? 200 : r.response.status
}

describe('authorizeAnalytics', () => {
  beforeEach(() => {
    process.env.FEATURE_ANALYTICS = '1'
    getProfile.mockReset()
    verifyClientOwnership.mockReset()
  })

  it('is a plain 404 when the flag is off, before touching the session', async () => {
    delete process.env.FEATURE_ANALYTICS
    expect(await status()).toBe(404)
    expect(getProfile).not.toHaveBeenCalled()
  })

  it('is not opened by the Search Console flag alone', async () => {
    delete process.env.FEATURE_ANALYTICS
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    try {
      expect(await status()).toBe(404)
    } finally {
      delete process.env.FEATURE_SEARCH_CONSOLE
    }
  })

  it('is 401 when signed out', async () => {
    getProfile.mockResolvedValue(null)
    expect(await status()).toBe(401)
  })

  it('is 403 below Pro, before any ownership lookup', async () => {
    getProfile.mockResolvedValue({ ...pro, accounts: { ...pro.accounts, plan: 'basic' } })
    expect(await status()).toBe(403)
    expect(verifyClientOwnership).not.toHaveBeenCalled()
  })

  it('is 403 for a cancelled Pro account, because entitlement reads status', async () => {
    getProfile.mockResolvedValue({ ...pro, accounts: { ...pro.accounts, status: 'cancelled' } })
    expect(await status()).toBe(403)
    expect(verifyClientOwnership).not.toHaveBeenCalled()
  })

  it('is 404 for a clientId that is not a UUID, before the ownership lookup', async () => {
    getProfile.mockResolvedValue(pro)
    expect(await status('not-a-uuid')).toBe(404)
    expect(verifyClientOwnership).not.toHaveBeenCalled()
  })

  it('is 404 for a brand that is not the account\'s', async () => {
    getProfile.mockResolvedValue(pro)
    verifyClientOwnership.mockResolvedValue(null)
    expect(await status()).toBe(404)
  })

  it('is 503 when the ownership lookup fails, never 404', async () => {
    getProfile.mockResolvedValue(pro)
    verifyClientOwnership.mockRejectedValue(new Error('db'))
    expect(await status()).toBe(503)
  })

  it('logs only the error name when the lookup fails, never its message', async () => {
    getProfile.mockResolvedValue(pro)
    const err = new Error('postgresql://user:secret@host/db')
    err.name = 'NeonDbError'
    verifyClientOwnership.mockRejectedValue(err)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await status()
      const logged = JSON.stringify(spy.mock.calls)
      expect(logged).toContain('NeonDbError')
      expect(logged).not.toContain('secret')
    } finally {
      spy.mockRestore()
    }
  })

  it('passes with the account from the session, never a caller id, and narrows the client', async () => {
    getProfile.mockResolvedValue(pro)
    verifyClientOwnership.mockResolvedValue({
      id: CLIENT_ID, domain: 'example.com', brand_name: 'Example', industry: null, competitors: [], status: 'active', created_at: 'x',
    })
    const r = await authorizeAnalytics(CLIENT_ID)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.client).toEqual({ id: CLIENT_ID, domain: 'example.com' })
    expect(verifyClientOwnership).toHaveBeenCalledWith(CLIENT_ID, 'a')
  })

  it('passes a null domain through as null', async () => {
    getProfile.mockResolvedValue(pro)
    verifyClientOwnership.mockResolvedValue({ id: CLIENT_ID, domain: null })
    const r = await authorizeAnalytics(CLIENT_ID)
    if (r.ok) expect(r.client.domain).toBeNull()
    else throw new Error('expected ok')
  })
})
