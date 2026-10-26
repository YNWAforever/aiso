import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieveSubscription: vi.fn(),
  sql: vi.fn(),
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}))

vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))

vi.mock('@/lib/stripe', () => ({
  stripe: {
    subscriptions: { retrieve: mocks.retrieveSubscription },
    webhooks: { constructEvent: mocks.constructEvent },
  },
  STRIPE_PRICES: {
    basic: 'price_basic_test',
    pro: 'price_pro_test',
    enterprise: 'price_enterprise_test',
  },
}))

// Reconstructs `p_foo => value` named-argument bindings from a tagged-template
// call so assertions can verify each Postgres parameter got the right JS
// value, the same way the real `sql\`... p_foo => ${x} ...\`` call site works.
// A mock that only inspected the raw query string would happily accept a
// transposed argument order — this is what makes that class of bug visible
// at the unit-test layer (an integration test against real Postgres is the
// other, stronger proof).
function functionName(strings: TemplateStringsArray): string | null {
  const match = strings.join('?').match(/select\s+(\w+)\s*\(/i)
  return match ? match[1] : null
}

function parseNamedArgs(strings: TemplateStringsArray, values: unknown[]): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (let i = 0; i < values.length; i++) {
    const match = strings[i].match(/(\w+)\s*=>\s*$/)
    if (match) args[match[1]] = values[i]
  }
  return args
}

function subscription({
  id = 'sub_xyz',
  customer = 'cus_abc',
  price = 'price_pro_test',
  status = 'active',
} = {}) {
  return {
    id,
    customer,
    status,
    items: { data: [{ price: { id: price } }] },
  }
}

function lifecycleEvent(type: string, object: Record<string, unknown>) {
  return {
    id: `evt_${type.replaceAll('.', '_')}`,
    created: 100,
    type,
    data: { object },
  }
}

async function postWebhook(event: object) {
  const { POST } = await import('@/app/api/stripe/webhook/route')
  mocks.constructEvent.mockReturnValueOnce(event)
  return POST(new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body: '{}',
    headers: { 'stripe-signature': 'valid-sig' },
  }))
}

function applyRpcArgs() {
  return mocks.calls.find(call => call.name === 'apply_stripe_account_event')?.args
}

describe('POST /api/stripe/webhook full lifecycle flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.calls.length = 0
    mocks.retrieveSubscription.mockResolvedValue(subscription())
    mocks.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const name = functionName(strings)
      if (!name) return []
      mocks.calls.push({ name, args: parseNamedArgs(strings, values) })
      if (name === 'acquire_stripe_subscription_lease') return [{ acquired: true }]
      if (name === 'release_stripe_subscription_lease') return [{ released: true }]
      return [{ result: 'applied' }]
    })
  })

  it('returns 400 when the Stripe signature is invalid', async () => {
    const { POST } = await import('@/app/api/stripe/webhook/route')
    mocks.constructEvent.mockImplementationOnce(() => {
      throw new Error('Invalid signature')
    })

    const response = await POST(new NextRequest('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 'invalid-sig' },
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/signature/i) })
  })

  it('links checkout to the account using canonical subscription state', async () => {
    const response = await postWebhook(lifecycleEvent('checkout.session.completed', {
      metadata: { account_id: 'acc-123', plan: 'basic' },
      customer: 'cus_abc',
      subscription: 'sub_xyz',
    }))

    expect(response.status).toBe(200)
    expect(mocks.retrieveSubscription).toHaveBeenCalledWith('sub_xyz')
    expect(applyRpcArgs()).toEqual(expect.objectContaining({
      p_account_id: 'acc-123',
      p_customer_id: 'cus_abc',
      p_subscription_id: 'sub_xyz',
      p_plan: 'pro',
      p_status: 'active',
      p_lease_owner: expect.any(String),
    }))
  })

  it('rejects checkout metadata without an account link', async () => {
    const response = await postWebhook(lifecycleEvent('checkout.session.completed', {
      metadata: {},
      customer: 'cus_abc',
      subscription: 'sub_xyz',
    }))

    expect(response.status).toBe(400)
    expect(mocks.retrieveSubscription).not.toHaveBeenCalled()
    expect(mocks.sql).not.toHaveBeenCalled()
  })

  it('applies an updated canonical Enterprise subscription', async () => {
    mocks.retrieveSubscription.mockResolvedValue(subscription({ price: 'price_enterprise_test' }))

    const response = await postWebhook(lifecycleEvent('customer.subscription.updated', {
      id: 'sub_xyz',
      status: 'active',
      items: { data: [{ price: { id: 'price_basic_test' } }] },
    }))

    expect(response.status).toBe(200)
    expect(applyRpcArgs()).toMatchObject({ p_plan: 'enterprise', p_status: 'active' })
  })

  it('maps a deleted canonical subscription to Basic/cancelled', async () => {
    mocks.retrieveSubscription.mockResolvedValue(subscription({ status: 'canceled' }))

    const response = await postWebhook(lifecycleEvent('customer.subscription.deleted', {
      id: 'sub_xyz',
    }))

    expect(response.status).toBe(200)
    expect(applyRpcArgs()).toMatchObject({ p_plan: 'basic', p_status: 'cancelled' })
  })

  it('maps invoice failure through canonical past_due state', async () => {
    mocks.retrieveSubscription.mockResolvedValue(subscription({ status: 'past_due' }))

    const response = await postWebhook(lifecycleEvent('invoice.payment_failed', {
      subscription: 'sub_xyz',
    }))

    expect(response.status).toBe(200)
    expect(applyRpcArgs()).toMatchObject({ p_plan: 'pro', p_status: 'past_due' })
  })

  it('returns 200 without persistence for unknown event types', async () => {
    const response = await postWebhook({
      id: 'evt_unknown',
      created: 100,
      type: 'some.unknown.event',
      data: { object: {} },
    })

    expect(response.status).toBe(200)
    expect(mocks.retrieveSubscription).not.toHaveBeenCalled()
    expect(mocks.sql).not.toHaveBeenCalled()
  })

  it('rejects an unrecognized canonical price without changing entitlement', async () => {
    mocks.retrieveSubscription.mockResolvedValue(subscription({ price: 'price_unknown' }))

    const response = await postWebhook(lifecycleEvent('customer.subscription.updated', {
      id: 'sub_xyz',
    }))

    expect(response.status).toBe(400)
    expect(applyRpcArgs()).toBeUndefined()
  })

  it.each([{ rows: [] }, { rows: [{ acquired: null }] }, { rows: [{ acquired: 'true' }] }])(
    'fails closed on an invalid lease response $rows before contacting Stripe', async ({ rows }) => {
      mocks.sql.mockResolvedValueOnce(rows)

      const response = await postWebhook(lifecycleEvent('customer.subscription.updated', { id: 'sub_xyz' }))

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Failed to acquire Stripe processing lease' })
      expect(mocks.retrieveSubscription).not.toHaveBeenCalled()
      expect(mocks.sql).toHaveBeenCalledOnce()
    },
  )

  it.each([{ rows: [] }, { rows: [{ result: null }] }, { rows: [{ result: 'unexpected' }] }])(
    'never acknowledges an unconfirmed persistence result $rows and releases the lease', async ({ rows }) => {
      mocks.sql.mockResolvedValueOnce([{ acquired: true }]).mockResolvedValueOnce(rows)

      const response = await postWebhook(lifecycleEvent('customer.subscription.updated', { id: 'sub_xyz' }))

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Failed to persist Stripe event' })
      expect(mocks.calls.at(-1)?.name).toBe('release_stripe_subscription_lease')
    },
  )

  it.each([
    ['different subscription', { ...subscription(), id: 'sub_other' }],
    ['different checkout customer', { ...subscription(), customer: 'cus_other' }],
    ['missing customer', { ...subscription(), customer: null }],
    ['multiple prices', { ...subscription(), items: { data: [
      { price: { id: 'price_pro_test' } }, { price: { id: 'price_basic_test' } },
    ] } }],
    ['no prices', { ...subscription(), items: { data: [] } }],
    ['unsupported status', { ...subscription(), status: 'unknown_status' }],
  ])('rejects canonical data with %s, writes no entitlement and releases the lease', async (_label, canonical) => {
    mocks.retrieveSubscription.mockResolvedValue(canonical)

    const response = await postWebhook(lifecycleEvent('checkout.session.completed', {
      metadata: { account_id: 'acc-123' }, customer: 'cus_abc', subscription: 'sub_xyz',
    }))

    expect(response.status).toBe(400)
    expect(applyRpcArgs()).toBeUndefined()
    expect(mocks.calls.map(call => call.name)).toEqual([
      'acquire_stripe_subscription_lease', 'release_stripe_subscription_lease',
    ])
    expect(mocks.calls[1].args).toEqual(mocks.calls[0].args)
  })

  it.each([['applied', 200], ['not_found', 503]] as const)(
    'preserves the %s outcome if lease cleanup fails', async (outcome, expectedStatus) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const sql = mocks.sql.getMockImplementation()!
      mocks.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (functionName(strings) === 'release_stripe_subscription_lease') throw new Error('cleanup unavailable')
        if (functionName(strings) === 'apply_stripe_account_event') return [{ result: outcome }]
        return sql(strings, ...values)
      })

      try {
        const response = await postWebhook(lifecycleEvent('customer.subscription.updated', { id: 'sub_xyz' }))

        expect(response.status).toBe(expectedStatus)
        expect(await response.json()).toEqual(outcome === 'applied'
          ? { ok: true } : { error: 'Stripe account linkage is not ready' })
        expect(log).toHaveBeenCalledWith('[stripe/webhook] lease release failed', expect.any(Error))
      } finally {
        log.mockRestore()
      }
    },
  )
})
