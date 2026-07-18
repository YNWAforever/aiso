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

async function postCheckout(body: object) {
  const { POST } = await import('@/app/api/stripe/checkout/route')
  return POST(new NextRequest('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

  it('falls back to English for an unsupported locale', async () => {
    const response = await postCheckout({ plan: 'enterprise', lang: 'javascript:alert(1)' })

    expect(response.status).toBe(200)
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ price: 'price_enterprise_test', quantity: 1 }],
      success_url: 'https://app.example.com/en/dashboard',
      cancel_url: 'https://app.example.com/en/pricing',
    }))
  })
})
