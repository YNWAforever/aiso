import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProfile = vi.hoisted(() => vi.fn())
const verifyClientOwnership = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/localTrust/store', () => ({ verifyClientOwnership }))

import { authorizeSearchConsole } from '@/lib/integrations/search-console/guard'

const pro = { id: 'p', account_id: 'a', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }
const status = async (clientId = 'c') => {
  const r = await authorizeSearchConsole(clientId)
  return r.ok ? 200 : r.response.status
}

describe('authorizeSearchConsole', () => {
  beforeEach(() => {
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    getProfile.mockReset()
    verifyClientOwnership.mockReset()
  })

  it('is a plain 404 when the flag is off, before touching the session', async () => {
    delete process.env.FEATURE_SEARCH_CONSOLE
    expect(await status()).toBe(404)
    expect(getProfile).not.toHaveBeenCalled()
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

  it('passes with the account from the session, never a caller id', async () => {
    getProfile.mockResolvedValue(pro)
    verifyClientOwnership.mockResolvedValue({ id: 'c', domain: 'example.com' })
    expect(await status('c')).toBe(200)
    expect(verifyClientOwnership).toHaveBeenCalledWith('c', 'a')
  })
})
