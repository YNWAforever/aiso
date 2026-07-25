/**
 * Stripe webhook — full event flow against the Neon `db()` client.
 * Covers signature verification, all four handled event types, the
 * deliberately-ignored cases, and the retry contract (DB failure ⇒ 5xx).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Env setup ──────────────────────────────────────────────────
process.env.STRIPE_WEBHOOK_SECRET   = 'whsec_test'
process.env.STRIPE_PRICE_PRO        = 'price_pro_test'
process.env.STRIPE_PRICE_BASIC      = 'price_basic_test'
process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise_test'

// ── Neon db() mock ─────────────────────────────────────────────
// db() returns a TAGGED TEMPLATE function, so the mock must be callable as
// sql`...` and never as sql('...'). Each call is recorded as the normalised
// SQL text plus its parameterised values.
const mocks = vi.hoisted(() => {
  const calls: { text: string; values: unknown[] }[] = []
  const state: { fail: boolean; rows: unknown[] } = { fail: false, rows: [{ id: 'acc-123' }] }
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(' ? ').replace(/\s+/g, ' ').trim(), values })
    if (state.fail) return Promise.reject(new Error('connect ECONNREFUSED'))
    return Promise.resolve(state.rows)
  }
  return { calls, state, sql }
})

vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))

// ── Stripe mock ────────────────────────────────────────────────
// constructEvent verifies the signature — mocked to return our test events.
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

async function nextEvent(event: object) {
  const { stripe } = await import('@/lib/stripe')
  vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce(event as never)
}

// Spy once at module scope — re-spying inside beforeEach would nest spies.
const warnSpy  = vi.spyOn(console, 'warn').mockImplementation(() => {})
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  mocks.calls.length = 0
  mocks.state.fail = false
  mocks.state.rows = [{ id: 'acc-123' }]
  warnSpy.mockClear()
  errorSpy.mockClear()
})

// ── Tests ──────────────────────────────────────────────────────
describe('POST /api/stripe/webhook — signature verification', () => {
  it('returns 400 when stripe signature is invalid', async () => {
    const { stripe } = await import('@/lib/stripe')
    vi.mocked(stripe.webhooks.constructEvent).mockImplementationOnce(() => {
      throw new Error('Invalid signature')
    })
    const res = await postWebhook({ type: 'checkout.session.completed' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/signature/i)
    expect(mocks.calls.length).toBe(0)
  })
})

describe('POST /api/stripe/webhook — checkout.session.completed', () => {
  it('upserts the account with pro plan on checkout.session.completed', async () => {
    await nextEvent({
      id:   'evt_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata:     { account_id: 'acc-123' },
          customer:     'cus_abc',
          subscription: 'sub_xyz',
        },
      },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    expect(mocks.calls.length).toBe(1)

    const call = mocks.calls[0]!
    expect(call.text).toMatch(/insert into accounts/i)
    expect(call.text).toMatch(/on conflict \(id\) do update set/i)
    expect(call.text).toContain("'pro'")
    expect(call.text).toContain("'active'")
    // id, stripe_customer_id, stripe_subscription_id — parameterised, in order
    expect(call.values).toEqual(['acc-123', 'cus_abc', 'sub_xyz'])
  })

  it('returns 200 and skips the write when metadata has no account_id', async () => {
    await nextEvent({
      id:   'evt_no_meta',
      type: 'checkout.session.completed',
      data: { object: { metadata: {}, customer: 'cus_abc', subscription: 'sub_xyz' } },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    expect(mocks.calls.length).toBe(0)
  })

  it('is idempotent across a redelivery of the same event', async () => {
    const event = {
      id:   'evt_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata:     { account_id: 'acc-123' },
          customer:     'cus_abc',
          subscription: 'sub_xyz',
        },
      },
    }
    await nextEvent(event)
    await postWebhook({})
    await nextEvent(event)
    await postWebhook({})

    expect(mocks.calls.length).toBe(2)
    expect(mocks.calls[0]!.text).toBe(mocks.calls[1]!.text)
    expect(mocks.calls[0]!.values).toEqual(mocks.calls[1]!.values)
  })
})

describe('POST /api/stripe/webhook — subscription events', () => {
  it('updates plan to pro on subscription.updated with the pro price', async () => {
    await nextEvent({
      id:   'evt_sub_updated',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id:     'sub_xyz',
          status: 'active',
          items:  { data: [{ price: { id: 'price_pro_test' } }] },
        },
      },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    expect(mocks.calls.length).toBe(1)
    expect(mocks.calls[0]!.text).toMatch(/update accounts/i)
    expect(mocks.calls[0]!.text).toMatch(/where stripe_subscription_id = \?/i)
    expect(mocks.calls[0]!.values).toEqual(['pro', 'active', 'sub_xyz'])
  })

  it('updates plan to enterprise on subscription.updated with the enterprise price', async () => {
    await nextEvent({
      id:   'evt_sub_ent',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id:     'sub_xyz',
          status: 'active',
          items:  { data: [{ price: { id: 'price_enterprise_test' } }] },
        },
      },
    })
    await postWebhook({})
    expect(mocks.calls[0]!.values[0]).toBe('enterprise')
  })

  it('still returns 200 when no account matches the subscription', async () => {
    mocks.state.rows = []
    await nextEvent({
      id:   'evt_sub_orphan',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_orphan', status: 'active', items: { data: [] } } },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(200)
  })

  it('sets plan to basic and status to cancelled on subscription.deleted', async () => {
    await nextEvent({
      id:   'evt_sub_deleted',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_xyz' } },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    expect(mocks.calls[0]!.text).toContain("'basic'")
    expect(mocks.calls[0]!.text).toContain("'cancelled'")
    expect(mocks.calls[0]!.values).toEqual(['sub_xyz'])
  })

  it('sets status to past_due on invoice.payment_failed', async () => {
    await nextEvent({
      id:   'evt_inv_failed',
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_xyz' } },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    expect(mocks.calls[0]!.text).toContain("'past_due'")
    expect(mocks.calls[0]!.values).toEqual(['sub_xyz'])
  })

  it('returns 200 and skips the write for an invoice with no subscription', async () => {
    await nextEvent({
      id:   'evt_inv_oneoff',
      type: 'invoice.payment_failed',
      data: { object: {} },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    expect(mocks.calls.length).toBe(0)
  })

  it('returns 200 for unknown event types so Stripe stops retrying', async () => {
    await nextEvent({
      id:   'evt_unknown',
      type: 'some.unknown.event',
      data: { object: {} },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    expect(mocks.calls.length).toBe(0)
  })
})

// ── Regression: the bug that was losing paid upgrades ───────────
// Every write used to be fire-and-forget against supabase-js, which resolves
// to { data, error } rather than throwing. A failed write therefore fell
// through to 200, Stripe marked the event delivered, and the upgrade was lost
// permanently. A DB failure must now surface as 5xx so Stripe redelivers.
describe('POST /api/stripe/webhook — DB failure must return 5xx (retryable)', () => {
  it('returns 500 when the checkout upsert fails', async () => {
    mocks.state.fail = true
    await nextEvent({
      id:   'evt_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata:     { account_id: 'acc-123' },
          customer:     'cus_abc',
          subscription: 'sub_xyz',
        },
      },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(500)
    expect(res.status).toBeGreaterThanOrEqual(500)
    const json = await res.json()
    expect(json.ok).toBeUndefined()
    expect(json.error).toBeTruthy()
  })

  it('returns 500 when the subscription.updated write fails', async () => {
    mocks.state.fail = true
    await nextEvent({
      id:   'evt_sub_updated',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id:     'sub_xyz',
          status: 'active',
          items:  { data: [{ price: { id: 'price_pro_test' } }] },
        },
      },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(500)
  })

  it('returns 500 when the subscription.deleted write fails', async () => {
    mocks.state.fail = true
    await nextEvent({
      id:   'evt_sub_deleted',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_xyz' } },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(500)
  })

  it('returns 500 when the invoice.payment_failed write fails', async () => {
    mocks.state.fail = true
    await nextEvent({
      id:   'evt_inv_failed',
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_xyz' } },
    })
    const res = await postWebhook({})
    expect(res.status).toBe(500)
  })

  it('logs the event id and type when a write fails', async () => {
    mocks.state.fail = true
    await nextEvent({
      id:   'evt_checkout',
      type: 'checkout.session.completed',
      data: { object: { metadata: { account_id: 'acc-123' } } },
    })
    await postWebhook({})
    const logged = errorSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(logged).toContain('evt_checkout')
    expect(logged).toContain('checkout.session.completed')
  })
})

describe('getPlan — price ID to plan mapping', () => {
  const cases: [string, string][] = [
    ['price_pro_test',        'pro'],
    ['price_basic_test',      'basic'],
    ['price_enterprise_test', 'enterprise'],
    ['price_unknown',         'basic'],
  ]

  for (const [priceId, plan] of cases) {
    it(`maps ${priceId} to ${plan}`, async () => {
      await nextEvent({
        id:   'evt_price',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub', status: 'active', items: { data: [{ price: { id: priceId } }] } } },
      })
      await postWebhook({})
      expect(mocks.calls[0]!.values[0]).toBe(plan)
    })
  }
})
