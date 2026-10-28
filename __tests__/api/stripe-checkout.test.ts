import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const createCheckoutSession = vi.fn()
const getProfile = vi.fn()

vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: createCheckoutSession } } },
  STRIPE_PRICES: {
    basic: 'price_basic_test',
    pro: 'price_pro_test',
    enterprise: 'price_enterprise_test',
  },
  APP_URL: 'https://app.example.com',
}))

vi.mock('@/lib/auth', () => ({ getProfile }))

async function postCheckout(body: unknown, raw = false) {
  const { POST } = await import('@/app/api/stripe/checkout/route')
  return POST(new NextRequest('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? String(body) : JSON.stringify(body),
  }))
}

describe('POST /api/stripe/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProfile.mockResolvedValue({ account_id: 'account-1', email: 'owner@example.com' })
    createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.test/session' })
  })

  it('preserves a supported Hong Kong Chinese locale in checkout return URLs', async () => {
    const response = await postCheckout({ plan: 'pro', lang: 'zh-HK' })

    expect(response.status).toBe(200)
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ price: 'price_pro_test', quantity: 1 }],
      success_url: 'https://app.example.com/zh-HK/dashboard',
      cancel_url: 'https://app.example.com/zh-HK/pricing',
    }))
  })

  it.each([null, [], 'pro', 1, { plan: {} }, { plan: null }, { plan: 1 }, { plan: 'pro', lang: [] }, { plan: 'pro', lang: null }])('rejects malformed checkout input %j without Stripe work', async body => {
    const response = await postCheckout(body)
    expect(response.status).toBe(400)
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it.each(['{', ' '.repeat(1025) + '{"plan":"pro"}'])('returns a stable 400 for malformed or oversized JSON', async body => {
    const response = await postCheckout(body, true)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid checkout request' })
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it('sanitizes Stripe failures in both the response and logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      createCheckoutSession.mockRejectedValue(new Error('private-customer-text', { cause: { key: 'private-customer-text' } }))
      const response = await postCheckout({ plan: 'pro' })
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Checkout temporarily unavailable' })
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-customer-text')
    } finally { log.mockRestore() }
  })

  it('falls back to English for an unsupported locale', async () => {
    const response = await postCheckout({ plan: 'enterprise', lang: 'javascript:alert(1)' })

    expect(response.status).toBe(200)
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ price: 'price_enterprise_test', quantity: 1 }],
      success_url: 'https://app.example.com/en/dashboard',
      cancel_url: 'https://app.example.com/en/pricing',
    }))
  })

  it.each(['free', 'unexpected', ''])('rejects non-checkout plan %j', async plan => {
    const response = await postCheckout({ plan, lang: 'en' })

    expect(response.status).toBe(400)
    expect(createCheckoutSession).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid plan. Use basic, pro, or enterprise.',
    })
  })

  it.each([
    ['basic', 'price_basic_test'],
    ['pro', 'price_pro_test'],
    ['enterprise', 'price_enterprise_test'],
  ] as const)('selects the catalog-backed Stripe price for %s', async (plan, price) => {
    const response = await postCheckout({ plan, lang: 'en' })

    expect(response.status).toBe(200)
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ price, quantity: 1 }],
      metadata: { account_id: 'account-1', plan },
    }))
  })
})
