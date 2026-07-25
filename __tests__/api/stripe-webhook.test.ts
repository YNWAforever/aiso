/**
 * Stripe webhook — retry contract.
 *
 * The handler's status code is its contract with Stripe: 200 stops delivery
 * forever, 5xx gets redelivered. Returning 200 after a failed write is how
 * paid upgrades were being lost silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

process.env.STRIPE_WEBHOOK_SECRET   = 'whsec_test'
process.env.STRIPE_PRICE_PRO        = 'price_pro_test'
process.env.STRIPE_PRICE_BASIC      = 'price_basic_test'
process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise_test'

// db() returns a tagged-template function — the mock must be callable as
// sql`...`, never as sql('...').
const mocks = vi.hoisted(() => {
  const calls: { text: string; values: unknown[] }[] = []
  const state = { fail: false }
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(' ? ').replace(/\s+/g, ' ').trim(), values })
    if (state.fail) return Promise.reject(new Error('connect ECONNREFUSED'))
    return Promise.resolve([{ id: 'acc-123' }])
  }
  return { calls, state, sql }
})

vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))

vi.mock('@/lib/stripe', () => ({
  stripe: { webhooks: { constructEvent: vi.fn() } },
}))

const CHECKOUT_EVENT = {
  id:   'evt_checkout_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      metadata:     { account_id: 'acc-123' },
      customer:     'cus_abc',
      subscription: 'sub_xyz',
    },
  },
}

async function postWebhook(event: object) {
  const { stripe } = await import('@/lib/stripe')
  vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce(event as never)
  const { POST } = await import('@/app/api/stripe/webhook/route')
  const req = new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body: '{}',
    headers: { 'stripe-signature': 'valid-sig' },
  })
  return POST(req)
}

vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  mocks.calls.length = 0
  mocks.state.fail = false
})

describe('stripe webhook retry contract', () => {
  it('returns 200 after a successful write', async () => {
    const res = await postWebhook(CHECKOUT_EVENT)
    expect(res.status).toBe(200)
    expect(mocks.calls.length).toBe(1)
  })

  it('REGRESSION: returns 5xx (not 200) when the DB write fails, so Stripe retries', async () => {
    mocks.state.fail = true
    const res = await postWebhook(CHECKOUT_EVENT)
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(res.status).not.toBe(200)
  })

  it('returns 200 for an event it deliberately ignores, so Stripe stops', async () => {
    const res = await postWebhook({ id: 'evt_x', type: 'some.unknown.event', data: { object: {} } })
    expect(res.status).toBe(200)
    expect(mocks.calls.length).toBe(0)
  })
})

// accounts.status CHECK, read from the live Neon schema:
//   CHECK (status = ANY (ARRAY['active','past_due','cancelled','trialing']))
// Anything else raises a CheckViolation, which the handler turns into a 500 —
// i.e. Stripe retries for ~3 days and fails every time. Stripe's own
// Subscription.Status union (node_modules/stripe .../Subscriptions.d.ts) has
// eight values, five of which are NOT in that list — note `canceled` (one L).
const DB_ALLOWED_STATUSES = ['active', 'past_due', 'cancelled', 'trialing']
const STRIPE_SUBSCRIPTION_STATUSES = [
  'active', 'canceled', 'incomplete', 'incomplete_expired',
  'past_due', 'paused', 'trialing', 'unpaid',
]

describe('stripe webhook status mapping', () => {
  it.each(STRIPE_SUBSCRIPTION_STATUSES)(
    'REGRESSION: maps Stripe status "%s" to a value accepted by the accounts CHECK',
    async (stripeStatus) => {
      await postWebhook({
        id: `evt_status_${stripeStatus}`,
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_1',
            status: stripeStatus,
            items: { data: [{ price: { id: 'price_pro_test' } }] },
          },
        },
      })
      // values = [plan, status, subscriptionId]
      const written = mocks.calls[0]!.values[1]
      expect(DB_ALLOWED_STATUSES).toContain(written)
    },
  )

  it('passes through the statuses the schema already understands', async () => {
    for (const s of ['active', 'past_due', 'trialing']) {
      mocks.calls.length = 0
      await postWebhook({
        id: `evt_pt_${s}`,
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', status: s, items: { data: [{ price: { id: 'price_pro_test' } }] } } },
      })
      expect(mocks.calls[0]!.values[1]).toBe(s)
    }
  })

  it("maps Stripe's `canceled` (one L) onto the schema's `cancelled` (two L)", async () => {
    await postWebhook({
      id: 'evt_canceled',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'canceled', items: { data: [{ price: { id: 'price_pro_test' } }] } } },
    })
    expect(mocks.calls[0]!.values[1]).toBe('cancelled')
  })
})

describe('stripe webhook plan mapping', () => {
  it('maps the pro price to the pro plan and unknown prices to basic', async () => {
    await postWebhook({
      id:   'evt_pro',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', items: { data: [{ price: { id: 'price_pro_test' } }] } } },
    })
    expect(mocks.calls[0]!.values[0]).toBe('pro')

    mocks.calls.length = 0
    await postWebhook({
      id:   'evt_unknown_price',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', items: { data: [{ price: { id: 'price_nope' } }] } } },
    })
    expect(mocks.calls[0]!.values[0]).toBe('basic')
  })
})
