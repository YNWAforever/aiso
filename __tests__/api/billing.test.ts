import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  resolveCommercialEntitlement: vi.fn(),
  loadClientBillingView: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getProfile: mocks.getProfile }))
vi.mock('@/lib/tier', () => ({ resolveCommercialEntitlement: mocks.resolveCommercialEntitlement }))
vi.mock('@/lib/billing/client-view', () => ({ loadClientBillingView: mocks.loadClientBillingView }))

import { GET } from '@/app/api/billing/route'

const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555'

const VIEW = {
  monthKey: '2026-11',
  mode: 'metered',
  reportedFixPacks: 3,
  notReportedFixPacks: 1,
  invoices: [],
  hasStripeCustomer: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getProfile.mockResolvedValue({
    id: 'profile-1',
    account_id: ACCOUNT_ID,
    is_admin: false,
    accounts: { plan: 'pro', status: 'active' },
  })
  mocks.resolveCommercialEntitlement.mockReturnValue({ plan: 'pro', source: 'paid', features: {} })
  mocks.loadClientBillingView.mockResolvedValue(VIEW)
})

describe('GET /api/billing', () => {
  it('rejects an unauthenticated request without reading billing data', async () => {
    mocks.getProfile.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(mocks.loadClientBillingView).not.toHaveBeenCalled()
  })

  it('returns the session account\'s billing view with the resolved plan', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ...VIEW, plan: 'pro' })
    expect(mocks.loadClientBillingView).toHaveBeenCalledWith(ACCOUNT_ID)
    expect(mocks.resolveCommercialEntitlement).toHaveBeenCalledWith({ plan: 'pro', status: 'active' })
  })

  it('returns 500 rather than an empty (zero-bill) view when the read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.loadClientBillingView.mockRejectedValue(new Error('connection terminated'))

    const response = await GET()

    expect(response.status).toBe(500)
    consoleError.mockRestore()
  })
})
