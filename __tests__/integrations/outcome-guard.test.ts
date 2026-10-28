import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ profile: vi.fn(), owned: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: h.profile }))
vi.mock('@/lib/localTrust/store', () => ({ verifyClientOwnership: h.owned }))
import { authorizeOutcomeClient } from '@/lib/outcome-integrations/guard'
import { PLAN_CATALOG } from '@/lib/plans/catalog'
const id = '22000000-0000-4000-8000-000000000001'
beforeEach(() => {
  vi.stubEnv('FEATURE_OUTCOME_INTEGRATIONS', '1')
  h.profile.mockReset().mockResolvedValue({ id: 'actor', account_id: 'account-a', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_fixture' } })
  h.owned.mockReset().mockResolvedValue({ id, account_id: 'account-a', domain: 'example.com' })
})
describe('outcome runtime entitlement and ownership', () => {
  it('gates from the shared plan catalogue', () => {
    expect(['free','basic','pro','enterprise'].map(plan => PLAN_CATALOG[plan as keyof typeof PLAN_CATALOG].features.outcome_integrations)).toEqual([false,false,true,true])
  })
  it('derives scope from the active profile and the owned client', async () => {
    expect((await authorizeOutcomeClient(id)).scope).toEqual({ accountId: 'account-a', clientId: id })
    expect(h.owned).toHaveBeenCalledWith(id, 'account-a')
  })
  it('fails closed while disabled before reading a profile or client', async () => {
    vi.stubEnv('FEATURE_OUTCOME_INTEGRATIONS', '0')
    await expect(authorizeOutcomeClient(id)).rejects.toMatchObject({ status: 404 })
    expect(h.profile).not.toHaveBeenCalled()
    expect(h.owned).not.toHaveBeenCalled()
  })
  it.each(['free','basic','cancelled'])('refuses %s before client lookup', async kind => {
    h.profile.mockResolvedValue({ account_id: 'account-a', accounts: { plan: kind === 'cancelled' ? 'pro' : kind, status: kind === 'cancelled' ? 'cancelled' : 'active', stripe_subscription_id: 'sub_fixture' } })
    await expect(authorizeOutcomeClient(id)).rejects.toMatchObject({ status: 403 })
    expect(h.owned).not.toHaveBeenCalled()
  })
  it('does not expose a foreign client or turn a lookup failure into an empty result', async () => {
    h.owned.mockResolvedValue(null)
    await expect(authorizeOutcomeClient(id)).rejects.toMatchObject({ status: 404 })
    h.owned.mockRejectedValue(new Error('private-connection-sentinel'))
    const error = await authorizeOutcomeClient(id).catch(error => error)
    expect(error).toMatchObject({ status: 503 })
    expect(String(error)).not.toContain('private-connection-sentinel')
    expect(error).not.toHaveProperty('cause')
  })
})
