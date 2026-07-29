import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const createCheckoutSession = vi.fn()
const getProfile = vi.fn()

// Isolated from __tests__/api/stripe-checkout.test.ts on purpose: this file's
// mock leaves `enterprise` unconfigured (undefined, matching an unset
// STRIPE_PRICE_ENTERPRISE at runtime) to exercise the 503 PLAN_UNAVAILABLE
// path without touching the fully-configured mock the other checkout tests
// rely on.
vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: createCheckoutSession } } },
  STRIPE_PRICES: {
    basic: 'price_basic_test',
    pro: 'price_pro_test',
    enterprise: undefined,
  },
  APP_URL: 'https://app.example.com',
}))

vi.mock('@/lib/auth', () => ({ getProfile }))

async function postCheckout(body: object) {
  const { POST } = await import('@/app/api/stripe/checkout/route')
  return POST(new NextRequest('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('POST /api/stripe/checkout — unconfigured plan price', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProfile.mockResolvedValue({ account_id: 'account-1', email: 'owner@example.com' })
  })

  it('returns 503 PLAN_UNAVAILABLE instead of 500 when the plan has no configured Stripe price', async () => {
    const response = await postCheckout({ plan: 'enterprise', lang: 'en' })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'PLAN_UNAVAILABLE',
      plan: 'enterprise',
    })
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it('still checks out a plan that does have a configured price', async () => {
    createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.test/session' })

    const response = await postCheckout({ plan: 'basic', lang: 'en' })

    expect(response.status).toBe(200)
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ price: 'price_basic_test', quantity: 1 }],
    }))
  })
})
