import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  createCheckoutSession: vi.fn(),
  getProfile: vi.fn(),
  upsertCalls: [] as Array<Record<string, unknown>>,
  updateCalls: [] as Array<Record<string, unknown>>,
  databaseError: null as Error | null,
}))

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: mocks.createCheckoutSession } },
    webhooks: { constructEvent: mocks.constructEvent },
  },
  STRIPE_PRICES: {
    basic: 'price_basic_test',
    pro: 'price_pro_test',
    enterprise: 'price_enterprise_test',
  },
  APP_URL: 'https://app.example.com',
}))

vi.mock('@/lib/auth', () => ({ getProfile: mocks.getProfile }))

vi.mock('@/lib/supabase-server', () => ({
  createServiceSupabaseClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnValue({
      upsert: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
        mocks.upsertCalls.push(data)
        return { error: mocks.databaseError }
      }),
      update: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
        eq: vi.fn().mockImplementation(async () => {
          mocks.updateCalls.push(data)
          return { error: mocks.databaseError }
        }),
      })),
    }),
  }),
}))

async function postCheckout(plan: string) {
  const { POST } = await import('@/app/api/stripe/checkout/route')
  return POST(new NextRequest('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan, lang: 'en' }),
  }))
}

async function postWebhook(event: object) {
  const { POST } = await import('@/app/api/stripe/webhook/route')
  mocks.constructEvent.mockReturnValueOnce(event)
  return POST(new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'valid-signature' },
    body: '{}',
  }))
}

function checkoutEvent(plan?: string) {
  return {
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        metadata: { account_id: 'account-1', ...(plan ? { plan } : {}) },
        customer: 'customer-1',
        subscription: 'subscription-1',
      },
    },
  }
}

describe('Stripe entitlement integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upsertCalls.length = 0
    mocks.updateCalls.length = 0
    mocks.databaseError = null
    mocks.getProfile.mockResolvedValue({ account_id: 'account-1', email: 'owner@example.com' })
    mocks.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.test/session' })
  })

  it.each(['basic', 'pro', 'enterprise'] as const)(
    'records the selected %s plan in server-created checkout metadata',
    async plan => {
      const response = await postCheckout(plan)

      expect(response.status).toBe(200)
      expect(mocks.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
        metadata: { account_id: 'account-1', plan },
      }))
    },
  )

  it.each(['basic', 'pro', 'enterprise'] as const)(
    'persists the purchased %s entitlement on checkout completion',
    async plan => {
      const response = await postWebhook(checkoutEvent(plan))

      expect(response.status).toBe(200)
      expect(mocks.upsertCalls).toEqual([expect.objectContaining({
        id: 'account-1',
        plan,
        stripe_customer_id: 'customer-1',
        stripe_subscription_id: 'subscription-1',
        status: 'active',
      })])
    },
  )

  it('rejects checkout completion without a supported plan instead of granting Pro', async () => {
    const response = await postWebhook(checkoutEvent())

    expect(response.status).toBe(400)
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('returns 500 when checkout entitlement persistence fails so Stripe retries', async () => {
    mocks.databaseError = new Error('database unavailable')

    const response = await postWebhook(checkoutEvent('basic'))

    expect(response.status).toBe(500)
  })

  it('rejects an unknown subscription price instead of silently downgrading to Basic', async () => {
    const response = await postWebhook({
      id: 'evt_subscription_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'subscription-1',
          status: 'active',
          items: { data: [{ price: { id: 'price_unknown' } }] },
        },
      },
    })

    expect(response.status).toBe(400)
    expect(mocks.updateCalls).toHaveLength(0)
  })

  it('returns 500 when a subscription entitlement update fails', async () => {
    mocks.databaseError = new Error('database unavailable')

    const response = await postWebhook({
      id: 'evt_subscription_2',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'subscription-1',
          status: 'active',
          items: { data: [{ price: { id: 'price_pro_test' } }] },
        },
      },
    })

    expect(response.status).toBe(500)
  })

  it('replays checkout completion idempotently with the same entitlement payload', async () => {
    const event = checkoutEvent('enterprise')

    expect((await postWebhook(event)).status).toBe(200)
    expect((await postWebhook(event)).status).toBe(200)
    expect(mocks.upsertCalls).toHaveLength(2)
    expect(mocks.upsertCalls[1]).toEqual(mocks.upsertCalls[0])
  })
})
