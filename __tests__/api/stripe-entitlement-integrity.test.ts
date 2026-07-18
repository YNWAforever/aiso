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
  rpc: vi.fn(),
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  operationOrder: [] as string[],
  legacyWrites: [] as Array<Record<string, unknown>>,
  rpcOutcome: 'applied' as RpcOutcome,
  leaseAcquired: true,
  databaseError: null as Error | null,
}))

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: mocks.createCheckoutSession } },
    subscriptions: { retrieve: mocks.retrieveSubscription },
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
    rpc: mocks.rpc,
    from: vi.fn().mockReturnValue({
      upsert: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
        mocks.legacyWrites.push(data)
        return { error: mocks.databaseError }
      }),
      update: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
        eq: vi.fn().mockImplementation(async () => {
          mocks.legacyWrites.push(data)
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
    mocks.legacyWrites.length = 0
    mocks.rpcOutcome = 'applied'
    mocks.leaseAcquired = true
    mocks.databaseError = null
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      mocks.rpcCalls.push({ name, args })
      mocks.operationOrder.push(name)
      if (name === 'acquire_stripe_subscription_lease') {
        return { data: mocks.leaseAcquired, error: null }
      }
      if (name === 'release_stripe_subscription_lease') {
        return { data: true, error: null }
      }
      return { data: mocks.rpcOutcome, error: mocks.databaseError }
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

    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      mocks.rpcCalls.push({ name, args })
      if (name === 'acquire_stripe_subscription_lease') {
        // The second acquire models crash recovery after the first 300-second lease expires.
        currentLeaseOwner = args.p_lease_owner
        return { data: true, error: null }
      }
      if (name === 'apply_stripe_account_event') {
        if (args.p_lease_owner !== currentLeaseOwner) {
          return { data: 'lease_lost', error: null }
        }
        appliedStatuses.push(args.p_status)
        return { data: 'applied', error: null }
      }
      if (name === 'release_stripe_subscription_lease') {
        if (args.p_lease_owner === currentLeaseOwner) currentLeaseOwner = null
        return { data: true, error: null }
      }
      throw new Error(`Unexpected RPC: ${name}`)
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

  it.each(['duplicate', 'stale'] as const)('acknowledges an atomically detected %s event', async outcome => {
    mocks.rpcOutcome = outcome

    const response = await postWebhook(subscriptionEvent())

    expect(response.status).toBe(200)
    expect(rpcNames()).toEqual([
      'acquire_stripe_subscription_lease',
      'apply_stripe_account_event',
      'release_stripe_subscription_lease',
    ])
  })

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

  it('returns 500 when atomic persistence fails so Stripe retries', async () => {
    mocks.databaseError = new Error('database unavailable')

    const response = await postWebhook(subscriptionEvent())

    expect(response.status).toBe(500)
  })

  it('rejects an unknown canonical price even when the event snapshot has a known price', async () => {
    mocks.retrieveSubscription.mockResolvedValue(subscription({ price: 'price_unknown' }))

    const response = await postWebhook(subscriptionEvent({ eventPrice: 'price_pro_test' }))

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
