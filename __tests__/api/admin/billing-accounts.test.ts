import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  openAccountBilling: vi.fn(),
}))

vi.mock('@/lib/admin-guard', () => ({ requireApiAdmin: mocks.requireApiAdmin }))
vi.mock('@/lib/billing/accounts', () => ({ openAccountBilling: mocks.openAccountBilling }))

import { POST } from '@/app/api/admin/billing/accounts/route'

const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555'
const ADMIN_ID = '99999999-8888-4777-8666-555555555555'

function request(body: unknown): Request {
  return new Request('http://localhost/api/admin/billing/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireApiAdmin.mockResolvedValue({ ok: true, profile: { id: ADMIN_ID, is_admin: true } })
  mocks.openAccountBilling.mockResolvedValue({
    status: 'ok',
    billing: {
      accountId: ACCOUNT_ID,
      mode: 'metered',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      stripeMeteredItemId: 'si_meter',
      openedBy: ADMIN_ID,
      openedAt: '2026-11-11T00:00:00Z',
      updatedAt: '2026-11-11T00:00:00Z',
    },
  })
})

describe('POST /api/admin/billing/accounts', () => {
  it('rejects a non-admin before touching billing', async () => {
    mocks.requireApiAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    })

    const response = await POST(request({ accountId: ACCOUNT_ID, mode: 'metered' }))

    expect(response.status).toBe(403)
    expect(mocks.openAccountBilling).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed json', undefined, 400],
    ['missing account id', { mode: 'metered' }, 400],
    ['non-uuid account id', { accountId: 'brand-1', mode: 'metered' }, 400],
    ['unknown mode', { accountId: ACCOUNT_ID, mode: 'unmetered' }, 400],
    ['unknown plan', { accountId: ACCOUNT_ID, mode: 'metered', plan: 'free' }, 400],
    ['non-boolean createSubscription', { accountId: ACCOUNT_ID, mode: 'metered', createSubscription: 'yes' }, 400],
  ])('rejects %s without calling the billing action', async (_label, body, expected) => {
    const response = body === undefined
      ? await POST(new Request('http://localhost/api/admin/billing/accounts', {
        method: 'POST',
        body: 'not json',
      }))
      : await POST(request(body))

    expect(response.status).toBe(expected)
    expect(mocks.openAccountBilling).not.toHaveBeenCalled()
  })

  it('opens billing with the session admin as the actor', async () => {
    const response = await POST(request({
      accountId: ACCOUNT_ID,
      mode: 'metered',
      plan: 'pro',
      createSubscription: true,
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.billing.mode).toBe('metered')
    expect(mocks.openAccountBilling).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      mode: 'metered',
      plan: 'pro',
      createSubscription: true,
      openedBy: ADMIN_ID,
    })
  })

  it.each([
    [{ status: 'account_not_found' }, 404],
    [{ status: 'metered_not_configured' }, 503],
    [{ status: 'subscription_required' }, 409],
    [{ status: 'account_link_failed' }, 503],
    [{ status: 'stripe_failed', code: 'METERED_ITEM_ATTACH_FAILED' }, 502],
  ])('maps %o to %i', async (outcome, expected) => {
    mocks.openAccountBilling.mockResolvedValue(outcome)

    const response = await POST(request({ accountId: ACCOUNT_ID, mode: 'metered' }))

    expect(response.status).toBe(expected)
  })

  it('returns 500 rather than a success when the billing action throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.openAccountBilling.mockRejectedValue(new Error('connection terminated'))

    const response = await POST(request({ accountId: ACCOUNT_ID, mode: 'metered' }))

    expect(response.status).toBe(500)
    consoleError.mockRestore()
  })
})
