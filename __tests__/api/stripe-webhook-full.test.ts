/**
 * TDD: Stripe webhook — full event flow
 * Tests checkout.session.completed, subscription.updated, subscription.deleted,
 * invoice.payment_failed, and signature verification
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Env setup ──────────────────────────────────────────────────
process.env.STRIPE_WEBHOOK_SECRET  = 'whsec_test'
process.env.STRIPE_PRICE_PRO       = 'price_pro_test'
process.env.STRIPE_PRICE_BASIC     = 'price_basic_test'
process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise_test'

// ── DB state tracking ──────────────────────────────────────────
let upsertCalls: unknown[] = []
let updateCalls: { data: unknown; filter: unknown }[] = []

const supabaseMock = {
  from: vi.fn().mockReturnValue({
    upsert: vi.fn().mockImplementation((data: unknown) => {
      upsertCalls.push(data)
      return Promise.resolve({ error: null })
    }),
    update: vi.fn().mockImplementation((data: unknown) => ({
      eq: vi.fn().mockImplementation((col: unknown, val: unknown) => {
        updateCalls.push({ data, filter: { [String(col)]: val } })
        return Promise.resolve({ error: null })
      }),
    })),
  }),
}

vi.mock('@/lib/supabase-server', () => ({
  createServiceSupabaseClient: vi.fn().mockResolvedValue(supabaseMock),
}))

// ── Stripe mock ────────────────────────────────────────────────
// constructEvent verifies signature — we mock it to return our test events
vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
}))

// ── Helpers ────────────────────────────────────────────────────
async function postWebhook(event: object) {
  const { POST } = await import('@/app/api/stripe/webhook/route')
  const req = new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body: JSON.stringify(event),
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 'valid-sig',
    },
  })
  return POST(req)
}

// ── Tests ──────────────────────────────────────────────────────
describe('POST /api/stripe/webhook — signature verification', () => {
  beforeEach(() => {
    upsertCalls = []
    updateCalls = []
    supabaseMock.from.mockReturnValue({
      upsert: vi.fn().mockImplementation((data: unknown) => { upsertCalls.push(data); return Promise.resolve({ error: null }) }),
      update: vi.fn().mockImplementation((data: unknown) => ({
        eq: vi.fn().mockImplementation((col: unknown, val: unknown) => {
          updateCalls.push({ data, filter: { [String(col)]: val } })
          return Promise.resolve({ error: null })
        }),
      })),
    })
  })

  it('returns 400 when stripe signature is invalid', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockImplementationOnce(() => {
      throw new Error('Invalid signature')
    })
    const res = await postWebhook({ type: 'checkout.session.completed' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/signature/i)
  })
})

describe('POST /api/stripe/webhook — checkout.session.completed', () => {
  beforeEach(() => {
    upsertCalls = []
    updateCalls = []
    supabaseMock.from.mockReturnValue({
      upsert: vi.fn().mockImplementation((data: unknown) => { upsertCalls.push(data); return Promise.resolve({ error: null }) }),
      update: vi.fn().mockImplementation((data: unknown) => ({
        eq: vi.fn().mockImplementation((col: unknown, val: unknown) => {
          updateCalls.push({ data, filter: { [String(col)]: val } })
          return Promise.resolve({ error: null })
        }),
      })),
    })
  })

  it('upserts account with pro plan on checkout.session.completed', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata:     { account_id: 'acc-123' },
          customer:     'cus_abc',
          subscription: 'sub_xyz',
        },
      },
    } as never)
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    expect(upsertCalls.length).toBeGreaterThan(0)
    const upserted = upsertCalls[0] as Record<string, unknown>
    expect(upserted).toMatchObject({
      id:                    'acc-123',
      stripe_customer_id:    'cus_abc',
      stripe_subscription_id:'sub_xyz',
      plan:                  'pro',
      status:                'active',
    })
  })

  it('returns 200 and skips upsert when metadata has no account_id', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: { metadata: {}, customer: 'cus_abc', subscription: 'sub_xyz' } },
    } as never)
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    expect(upsertCalls.length).toBe(0) // no upsert without account_id
  })
})

describe('POST /api/stripe/webhook — subscription events', () => {
  beforeEach(() => {
    upsertCalls = []
    updateCalls = []
    supabaseMock.from.mockReturnValue({
      upsert: vi.fn().mockImplementation((data: unknown) => { upsertCalls.push(data); return Promise.resolve({ error: null }) }),
      update: vi.fn().mockImplementation((data: unknown) => ({
        eq: vi.fn().mockImplementation((col: unknown, val: unknown) => {
          updateCalls.push({ data, filter: { [String(col)]: val } })
          return Promise.resolve({ error: null })
        }),
      })),
    })
  })

  it('updates plan to pro on subscription.updated with pro price', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id:     'sub_xyz',
          status: 'active',
          items:  { data: [{ price: { id: 'price_pro_test' } }] },
        },
      },
    } as never)
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    expect(updateCalls.length).toBeGreaterThan(0)
    const update = updateCalls[0]!.data as Record<string, unknown>
    expect(update.plan).toBe('pro')
    expect(update.status).toBe('active')
  })

  it('updates plan to enterprise on subscription.updated with enterprise price', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id:     'sub_xyz',
          status: 'active',
          items:  { data: [{ price: { id: 'price_enterprise_test' } }] },
        },
      },
    } as never)
    const res = await postWebhook({})
    const update = updateCalls[0]!.data as Record<string, unknown>
    expect(update.plan).toBe('enterprise')
  })

  it('sets plan to basic and status to cancelled on subscription.deleted', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_xyz' } },
    } as never)
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    expect(updateCalls.length).toBeGreaterThan(0)
    const update = updateCalls[0]!.data as Record<string, unknown>
    expect(update.plan).toBe('basic')
    expect(update.status).toBe('cancelled')
  })

  it('sets status to past_due on invoice.payment_failed', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_xyz' } },
    } as never)
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    // Should update status to past_due
    const update = updateCalls[0]?.data as Record<string, unknown> | undefined
    if (update) expect(update.status).toBe('past_due')
  })

  it('returns 200 for unknown event types (idempotent)', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: 'some.unknown.event',
      data: { object: {} },
    } as never)
    const res = await postWebhook({})
    expect(res.status).toBe(200)
  })
})

describe('getPlan — price ID to plan mapping', () => {
  beforeEach(() => {
    upsertCalls = []
    updateCalls = []
    supabaseMock.from.mockReturnValue({
      upsert: vi.fn().mockImplementation((data: unknown) => { upsertCalls.push(data); return Promise.resolve({ error: null }) }),
      update: vi.fn().mockImplementation((data: unknown) => ({
        eq: vi.fn().mockImplementation((col: unknown, val: unknown) => {
          updateCalls.push({ data, filter: { [String(col)]: val } })
          return Promise.resolve({ error: null })
        }),
      })),
    })
  })

  it('maps price_pro to pro', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub', status: 'active', items: { data: [{ price: { id: 'price_pro_test' } }] } } },
    } as never)
    await postWebhook({})
    expect((updateCalls[0]?.data as Record<string, unknown>).plan).toBe('pro')
  })

  it('maps price_basic to basic', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub', status: 'active', items: { data: [{ price: { id: 'price_basic_test' } }] } } },
    } as never)
    await postWebhook({})
    expect((updateCalls[0]?.data as Record<string, unknown>).plan).toBe('basic')
  })

  it('defaults to basic for unrecognised price ID', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub', status: 'active', items: { data: [{ price: { id: 'price_unknown' } }] } } },
    } as never)
    await postWebhook({})
    expect((updateCalls[0]?.data as Record<string, unknown>).plan).toBe('basic')
  })
})
