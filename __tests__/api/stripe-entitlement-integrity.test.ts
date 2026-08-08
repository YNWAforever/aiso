import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type RpcOutcome = 'applied' | 'duplicate' | 'stale' | 'not_found' | 'lease_lost'

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  createCheckoutSession: vi.fn(),
  retrieveSubscription: vi.fn(),
  getProfile: vi.fn(),
  sql: vi.fn(),
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  operationOrder: [] as string[],
  rpcOutcome: 'applied' as RpcOutcome,
  leaseAcquired: true,
  // Simulates a thrown Neon query error (Neon throws on failure, unlike
  // supabase-js's `{ data, error }` shape), not a resolved-with-error value.
  applyThrows: null as Error | null,
  stripePrices: {
    basic: 'price_basic_test',
    pro: 'price_pro_test',
    enterprise: 'price_enterprise_test',
  },
}))

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: mocks.createCheckoutSession } },
    subscriptions: { retrieve: mocks.retrieveSubscription },
    webhooks: { constructEvent: mocks.constructEvent },
  },
  STRIPE_PRICES: mocks.stripePrices,
  APP_URL: 'https://app.example.com',
}))

vi.mock('@/lib/auth', () => ({ getProfile: mocks.getProfile }))

vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))

// Reconstructs `p_foo => value` named-argument bindings from a tagged-template
// call so assertions can verify each Postgres parameter got the right JS
// value — the same binding the real `sql\`... p_foo => ${x} ...\`` call site
// performs. A mock that only inspected the raw query string would happily
// accept a transposed argument order; this is what makes that class of bug
// visible at the unit-test layer (the integration test is the stronger proof,
// since it runs the real functions).
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

function subscription({
  id = 'subscription-1',
  customer = 'customer-1',
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

function checkoutEvent(metadataPlan = 'enterprise') {
  return {
    id: 'evt_checkout_1',
    created: 100,
    type: 'checkout.session.completed',
    data: {
      object: {
        metadata: { account_id: 'account-1', plan: metadataPlan },
        customer: 'customer-1',
        subscription: 'subscription-1',
      },
    },
  }
}

function subscriptionEvent({
  eventId = 'evt_subscription_1',
  created = 100,
  eventType = 'customer.subscription.updated',
  eventStatus = 'active',
  eventPrice = 'price_pro_test',
} = {}) {
  return {
    id: eventId,
    created,
    type: eventType,
    data: {
      object: subscription({ status: eventStatus, price: eventPrice }),
    },
  }
}

function rpcNames() {
  return mocks.rpcCalls.map(call => call.name)
}

function applyRpcArgs() {
  return mocks.rpcCalls.find(call => call.name === 'apply_stripe_account_event')?.args
}

describe('Stripe lifecycle migration', () => {
  const migrationPath = resolve('supabase/migrations/024_stripe_lifecycle_integrity.sql')
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''

  it('ships one atomic locked event ledger and account update RPC', () => {
    expect(migration).toMatch(/create table if not exists public\.stripe_webhook_events/i)
    expect(migration).toMatch(/event_id text primary key/i)
    expect(migration).toMatch(/for update/i)
    expect(migration).toMatch(/on conflict \(event_id\) do nothing/i)
    expect(migration).toMatch(/return 'not_found'/i)
    expect(migration).toMatch(/return 'duplicate'/i)
    expect(migration).toMatch(/return 'stale'/i)
  })

  it('ships a durable expiring per-subscription processing lease', () => {
    expect(migration).toMatch(/create table if not exists public\.stripe_subscription_processing_leases/i)
    expect(migration).toMatch(/subscription_id text primary key/i)
    expect(migration).toMatch(/lease_owner uuid not null/i)
    expect(migration).toMatch(/lease_expires_at timestamptz not null/i)
    expect(migration).toMatch(/create or replace function public\.acquire_stripe_subscription_lease/i)
    expect(migration).toMatch(/on conflict \(subscription_id\) do update/i)
    expect(migration).toMatch(/lease_expires_at\s*<=\s*clock_timestamp\(\)/i)
    expect(migration).toMatch(/interval '300 seconds'/i)
  })

  it('atomically fences stale lease owners before applying account state', () => {
    expect(migration).toMatch(
      /apply_stripe_account_event\([\s\S]*p_lease_owner uuid[\s\S]*where[\s\S]*subscription_id = p_subscription_id[\s\S]*lease_owner = p_lease_owner[\s\S]*lease_expires_at > clock_timestamp\(\)[\s\S]*for update/i,
    )
    expect(migration).toMatch(/return 'lease_lost'/i)
    expect(migration).toMatch(/create or replace function public\.release_stripe_subscription_lease/i)
    expect(migration).toMatch(
      /delete from public\.stripe_subscription_processing_leases[\s\S]*subscription_id = p_subscription_id[\s\S]*lease_owner = p_lease_owner/i,
    )
  })

  it('keeps the ledger private and never treats lexical event IDs as chronology', () => {
    expect(migration).toMatch(/security invoker/i)
    expect(migration).toMatch(/set search_path = ''/i)
    expect(migration).toMatch(/alter table public\.stripe_webhook_events enable row level security/i)
    expect(migration).toMatch(
      /revoke all on table public\.stripe_webhook_events from public/i,
    )
    for (const role of ['anon', 'authenticated']) {
      expect(migration).toContain(`if to_regrole('${role}') is not null then`)
      expect(migration).toContain(
        `revoke all on table public.stripe_webhook_events from ${role}`,
      )
    }
    expect(migration).toContain("if to_regrole('service_role') is not null then")
    expect(migration).toContain(
      'grant select, insert on table public.stripe_webhook_events to service_role',
    )
    expect(migration).not.toMatch(/p_event_id\s*[<>]/i)
  })
})

describe('Stripe entitlement integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpcCalls.length = 0
    mocks.operationOrder.length = 0
    mocks.rpcOutcome = 'applied'
    mocks.leaseAcquired = true
    mocks.applyThrows = null
    Object.assign(mocks.stripePrices, {
      basic: 'price_basic_test',
      pro: 'price_pro_test',
      enterprise: 'price_enterprise_test',
    })
    mocks.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const name = functionName(strings)
      if (!name) return []
      const args = parseNamedArgs(strings, values)
      mocks.rpcCalls.push({ name, args })
      mocks.operationOrder.push(name)
      if (name === 'acquire_stripe_subscription_lease') {
        return [{ acquired: mocks.leaseAcquired }]
      }
      if (name === 'release_stripe_subscription_lease') {
        return [{ released: true }]
      }
      // apply_stripe_account_event
      if (mocks.applyThrows) throw mocks.applyThrows
      return [{ result: mocks.rpcOutcome }]
    })
    mocks.getProfile.mockResolvedValue({ account_id: 'account-1', email: 'owner@example.com' })
    mocks.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.test/session' })
    mocks.retrieveSubscription.mockImplementation(async () => {
      mocks.operationOrder.push('retrieve_subscription')
      return subscription()
    })
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

  it('derives checkout entitlement from the purchased price instead of plan metadata', async () => {
    mocks.retrieveSubscription.mockResolvedValue(subscription({ price: 'price_basic_test' }))

    const response = await postWebhook(checkoutEvent('enterprise'))

    expect(response.status).toBe(200)
    expect(mocks.rpcCalls).toContainEqual({
      name: 'apply_stripe_account_event',
      args: expect.objectContaining({
        p_account_id: 'account-1',
        p_subscription_id: 'subscription-1',
        p_customer_id: 'customer-1',
        p_plan: 'basic',
        p_status: 'active',
        p_event_created: 100,
        p_event_id: 'evt_checkout_1',
        p_event_type: 'checkout.session.completed',
        p_lease_owner: expect.any(String),
      }),
    })
  })

  it('holds a per-subscription lease from before canonical retrieval through atomic apply', async () => {
    const response = await postWebhook(subscriptionEvent())

    expect(response.status).toBe(200)
    expect(mocks.operationOrder).toEqual([
      'acquire_stripe_subscription_lease',
      'retrieve_subscription',
      'apply_stripe_account_event',
      'release_stripe_subscription_lease',
    ])

    const acquire = mocks.rpcCalls[0]
    const apply = mocks.rpcCalls[1]
    const release = mocks.rpcCalls[2]
    expect(acquire.args).toMatchObject({ p_subscription_id: 'subscription-1' })
    expect(apply.args.p_lease_owner).toBe(acquire.args.p_lease_owner)
    expect(release.args).toEqual({
      p_subscription_id: 'subscription-1',
      p_lease_owner: acquire.args.p_lease_owner,
    })
  })

  it('returns retryable 503 before canonical retrieval when another handler owns the lease', async () => {
    mocks.leaseAcquired = false

    const response = await postWebhook(subscriptionEvent())

    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBeTruthy()
    expect(mocks.retrieveSubscription).not.toHaveBeenCalled()
    expect(mocks.rpcCalls.map(call => call.name)).toEqual(['acquire_stripe_subscription_lease'])
  })

  it('returns retryable 503 when an expired or stolen lease fences the old handler at apply time', async () => {
    mocks.rpcOutcome = 'lease_lost'

    const response = await postWebhook(subscriptionEvent())

    expect(response.status).toBe(503)
    expect(mocks.rpcCalls.map(call => call.name)).toEqual([
      'acquire_stripe_subscription_lease',
      'apply_stripe_account_event',
      'release_stripe_subscription_lease',
    ])
  })

  it('prevents a stalled active snapshot from overwriting an equal-second cancellation after lease takeover', async () => {
    let currentLeaseOwner: unknown = null
    const appliedStatuses: unknown[] = []
    let resolveStalledRetrieval!: (value: ReturnType<typeof subscription>) => void
    const stalledRetrieval = new Promise<ReturnType<typeof subscription>>(resolve => {
      resolveStalledRetrieval = resolve
    })

    mocks.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const name = functionName(strings)
      if (!name) return []
      const args = parseNamedArgs(strings, values)
      mocks.rpcCalls.push({ name, args })
      if (name === 'acquire_stripe_subscription_lease') {
        // The second acquire models crash recovery after the first 300-second lease expires.
        currentLeaseOwner = args.p_lease_owner
        return [{ acquired: true }]
      }
      if (name === 'apply_stripe_account_event') {
        if (args.p_lease_owner !== currentLeaseOwner) {
          return [{ result: 'lease_lost' }]
        }
        appliedStatuses.push(args.p_status)
        return [{ result: 'applied' }]
      }
      if (name === 'release_stripe_subscription_lease') {
        if (args.p_lease_owner === currentLeaseOwner) currentLeaseOwner = null
        return [{ released: true }]
      }
      throw new Error(`Unexpected function call: ${name}`)
    })
    mocks.retrieveSubscription
      .mockImplementationOnce(() => stalledRetrieval)
      .mockResolvedValueOnce(subscription({ status: 'canceled' }))

    const stalledActive = postWebhook(subscriptionEvent({ eventId: 'evt_active', created: 100 }))
    await vi.waitFor(() => expect(mocks.retrieveSubscription).toHaveBeenCalledTimes(1))

    const cancelled = await postWebhook(subscriptionEvent({
      eventId: 'evt_cancelled',
      created: 100,
      eventType: 'customer.subscription.deleted',
      eventStatus: 'canceled',
    }))
    expect(cancelled.status).toBe(200)

    resolveStalledRetrieval(subscription({ status: 'active' }))
    const fencedActive = await stalledActive

    expect(fencedActive.status).toBe(503)
    expect(appliedStatuses).toEqual(['cancelled'])
  })

  it('best-effort releases the lease when canonical Stripe retrieval fails', async () => {
    mocks.retrieveSubscription.mockRejectedValue(new Error('Stripe unavailable'))

    const response = await postWebhook(subscriptionEvent())

    expect(response.status).toBe(500)
    expect(mocks.rpcCalls.map(call => call.name)).toEqual([
      'acquire_stripe_subscription_lease',
      'release_stripe_subscription_lease',
    ])
  })

  it.each([
    ['active', 'pro', 'active'],
    ['trialing', 'pro', 'trialing'],
    ['past_due', 'pro', 'past_due'],
    ['incomplete', 'pro', 'past_due'],
    ['incomplete_expired', 'basic', 'cancelled'],
    ['canceled', 'basic', 'cancelled'],
    ['unpaid', 'basic', 'cancelled'],
    ['paused', 'basic', 'cancelled'],
  ] as const)('maps Stripe %s to DB-safe %s/%s state', async (stripeStatus, plan, accountStatus) => {
    mocks.retrieveSubscription.mockResolvedValue(subscription({ status: stripeStatus }))

    const response = await postWebhook(subscriptionEvent({ eventStatus: 'active' }))

    expect(response.status).toBe(200)
    expect(applyRpcArgs()).toMatchObject({
      p_plan: plan,
      p_status: accountStatus,
      p_event_created: 100,
      p_event_id: 'evt_subscription_1',
    })
  })

  it('uses the canonical subscription when a delayed event contains stale state', async () => {
    mocks.retrieveSubscription.mockResolvedValue(subscription({
      price: 'price_enterprise_test',
      status: 'canceled',
    }))

    const response = await postWebhook(subscriptionEvent({
      eventId: 'evt_old',
      created: 50,
      eventStatus: 'active',
      eventPrice: 'price_pro_test',
    }))

    expect(response.status).toBe(200)
    expect(applyRpcArgs()).toMatchObject({
      p_plan: 'basic',
      p_status: 'cancelled',
      p_event_created: 50,
      p_event_id: 'evt_old',
    })
  })

  it.each(['duplicate', 'stale'] as const)(
    'acknowledges an atomically detected %s event without regressing subscription state — an idempotent replay (duplicate) or an out-of-order delivery (stale) both must not overwrite current state',
    async outcome => {
      mocks.rpcOutcome = outcome

      const response = await postWebhook(subscriptionEvent())

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true })
      expect(rpcNames()).toEqual([
        'acquire_stripe_subscription_lease',
        'apply_stripe_account_event',
        'release_stripe_subscription_lease',
      ])
    },
  )

  it('returns retryable 503 when account linkage does not exist yet', async () => {
    mocks.rpcOutcome = 'not_found'

    const response = await postWebhook(subscriptionEvent())

    expect(response.status).toBe(503)
  })

  it('returns retryable 503 when subscription.created arrives before checkout links the account', async () => {
    mocks.rpcOutcome = 'not_found'

    const response = await postWebhook(subscriptionEvent({
      eventId: 'evt_subscription_created',
      eventType: 'customer.subscription.created',
    }))

    expect(response.status).toBe(503)
    expect(rpcNames()).toEqual([
      'acquire_stripe_subscription_lease',
      'apply_stripe_account_event',
      'release_stripe_subscription_lease',
    ])
  })

  it('returns 500 — never { ok: true } — when the database throws persisting the event, and still releases the lease', async () => {
    // Neon throws on a failed query; it does not resolve `{ data, error }`
    // the way supabase-js did. This is the exact bug the migration fixes:
    // a discarded `error` field used to fall through to `{ ok: true }`,
    // which told Stripe the event was handled when the write never happened.
    mocks.applyThrows = new Error('connection terminated unexpectedly')

    const response = await postWebhook(subscriptionEvent())

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).not.toEqual({ ok: true })
    expect(body).toMatchObject({ error: expect.any(String) })
    // The lease must not leak just because the write threw: the failed
    // apply attempt is followed by a release, not skipped straight to it.
    expect(rpcNames()).toEqual([
      'acquire_stripe_subscription_lease',
      'apply_stripe_account_event',
      'release_stripe_subscription_lease',
    ])
  })

  it('rejects an unknown canonical price even when the event snapshot has a known price', async () => {
    mocks.retrieveSubscription.mockResolvedValue(subscription({ price: 'price_unknown' }))

    const response = await postWebhook(subscriptionEvent({ eventPrice: 'price_pro_test' }))

    expect(response.status).toBe(400)
    expect(applyRpcArgs()).toBeUndefined()
  })

  it('rejects an ambiguous canonical Stripe price without changing entitlement', async () => {
    mocks.stripePrices.basic = 'duplicate_price'
    mocks.stripePrices.pro = 'duplicate_price'
    mocks.retrieveSubscription.mockResolvedValue(subscription({ price: 'duplicate_price' }))

    const response = await postWebhook(subscriptionEvent())

    expect(response.status).toBe(400)
    expect(applyRpcArgs()).toBeUndefined()
  })

  it('returns 500 when Stripe cannot retrieve canonical subscription state', async () => {
    mocks.retrieveSubscription.mockRejectedValue(new Error('Stripe unavailable'))

    const response = await postWebhook(subscriptionEvent())

    expect(response.status).toBe(500)
    expect(applyRpcArgs()).toBeUndefined()
  })

  it.each([
    { id: '', created: 100 },
    { id: 'evt_subscription_1', created: undefined },
  ])('rejects lifecycle events without durable ordering metadata', async ({ id, created }) => {
    const event = { ...subscriptionEvent(), id, created }

    const response = await postWebhook(event)

    expect(response.status).toBe(400)
    expect(mocks.rpcCalls).toHaveLength(0)
  })
})
