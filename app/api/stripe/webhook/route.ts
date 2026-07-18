import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { stripe, STRIPE_PRICES } from '@/lib/stripe'
import { createServiceSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

type Plan = 'basic' | 'pro' | 'enterprise'
type AccountStatus = 'active' | 'past_due' | 'cancelled' | 'trialing'
type PersistenceOutcome = 'applied' | 'duplicate' | 'stale' | 'not_found' | 'lease_lost'
type ServiceSupabaseClient = Awaited<ReturnType<typeof createServiceSupabaseClient>>

type CanonicalSubscription = {
  id: string
  customer?: unknown
  status: string
  items?: {
    data?: Array<{
      price?: { id?: string }
    }>
  }
}

const LIFECYCLE_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
])

function getPlan(priceId: string): Plan | null {
  if (priceId === STRIPE_PRICES.enterprise) return 'enterprise'
  if (priceId === STRIPE_PRICES.pro) return 'pro'
  if (priceId === STRIPE_PRICES.basic) return 'basic'
  return null
}

function getPurchasedPlan(subscription: CanonicalSubscription): Plan | null {
  const items = subscription.items?.data
  if (!Array.isArray(items) || items.length !== 1) return null
  return getPlan(items[0]?.price?.id ?? '')
}

function getAccountState(
  stripeStatus: string,
  purchasedPlan: Plan,
): { plan: Plan; status: AccountStatus } | null {
  if (stripeStatus === 'active') return { plan: purchasedPlan, status: 'active' }
  if (stripeStatus === 'trialing') return { plan: purchasedPlan, status: 'trialing' }
  if (stripeStatus === 'past_due' || stripeStatus === 'incomplete') {
    return { plan: purchasedPlan, status: 'past_due' }
  }
  if (
    stripeStatus === 'incomplete_expired'
    || stripeStatus === 'canceled'
    || stripeStatus === 'unpaid'
    || stripeStatus === 'paused'
  ) {
    return { plan: 'basic', status: 'cancelled' }
  }
  return null
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id
  }
  return null
}

function invalidEvent(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function retryableLeaseResponse(message: string) {
  return NextResponse.json(
    { error: message },
    { status: 503, headers: { 'Retry-After': '5' } },
  )
}

function getSubscriptionId(eventType: string, object: Record<string, unknown>): string | null {
  if (eventType === 'checkout.session.completed' || eventType === 'invoice.payment_failed') {
    return stripeId(object.subscription)
  }
  return stripeId(object.id)
}

async function persistEvent(args: {
  supabase: ServiceSupabaseClient
  accountId: string | null
  customerId: string
  subscriptionId: string
  plan: Plan
  status: AccountStatus
  eventCreated: number
  eventId: string
  eventType: string
  leaseOwner: string
}) {
  const { data, error } = await args.supabase.rpc('apply_stripe_account_event', {
    p_account_id: args.accountId,
    p_subscription_id: args.subscriptionId,
    p_customer_id: args.customerId,
    p_plan: args.plan,
    p_status: args.status,
    p_event_created: args.eventCreated,
    p_event_id: args.eventId,
    p_event_type: args.eventType,
    p_lease_owner: args.leaseOwner,
  })

  if (error) {
    console.error('[stripe/webhook] persistence failed', error)
    return NextResponse.json({ error: 'Failed to persist Stripe event' }, { status: 500 })
  }

  const outcome = data as PersistenceOutcome
  if (outcome === 'not_found') {
    return NextResponse.json({ error: 'Stripe account linkage is not ready' }, { status: 503 })
  }
  if (outcome === 'lease_lost') {
    return retryableLeaseResponse('Stripe subscription processing lease was lost')
  }
  if (outcome === 'applied' || outcome === 'duplicate' || outcome === 'stale') {
    return null
  }

  console.error('[stripe/webhook] unexpected persistence outcome', data)
  return NextResponse.json({ error: 'Failed to persist Stripe event' }, { status: 500 })
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature') ?? ''

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (!LIFECYCLE_EVENTS.has(event.type)) {
    return NextResponse.json({ ok: true })
  }

  if (
    typeof event.id !== 'string'
    || !event.id
    || typeof event.created !== 'number'
    || !Number.isInteger(event.created)
    || event.created < 0
  ) {
    return invalidEvent('Invalid Stripe event metadata')
  }

  const object = event.data.object as unknown as Record<string, unknown>
  const subscriptionId = getSubscriptionId(event.type, object)
  if (!subscriptionId) return invalidEvent('Invalid event subscription')

  let accountId: string | null = null
  let checkoutCustomerId: string | null = null
  if (event.type === 'checkout.session.completed') {
    const metadata = object.metadata as { account_id?: unknown } | null | undefined
    accountId = typeof metadata?.account_id === 'string' && metadata.account_id
      ? metadata.account_id
      : null
    checkoutCustomerId = stripeId(object.customer)
    if (!accountId || !checkoutCustomerId) {
      return invalidEvent('Invalid checkout metadata')
    }
  }

  const leaseOwner = randomUUID()
  let leaseAcquired = false
  let supabase: ServiceSupabaseClient | null = null

  try {
    supabase = await createServiceSupabaseClient()
    const { data: acquired, error: acquireError } = await supabase.rpc(
      'acquire_stripe_subscription_lease',
      {
        p_subscription_id: subscriptionId,
        p_lease_owner: leaseOwner,
      },
    )

    if (acquireError) {
      console.error('[stripe/webhook] lease acquisition failed', acquireError)
      return NextResponse.json({ error: 'Failed to acquire Stripe processing lease' }, { status: 500 })
    }
    if (acquired === false) {
      return retryableLeaseResponse('Stripe subscription is already being processed')
    }
    if (acquired !== true) {
      console.error('[stripe/webhook] unexpected lease acquisition outcome', acquired)
      return NextResponse.json({ error: 'Failed to acquire Stripe processing lease' }, { status: 500 })
    }
    leaseAcquired = true

    const subscription = await stripe.subscriptions.retrieve(subscriptionId) as unknown as CanonicalSubscription
    if (!subscription || subscription.id !== subscriptionId) {
      return invalidEvent('Invalid canonical subscription')
    }

    const customerId = stripeId(subscription.customer)
    if (!customerId || (checkoutCustomerId && checkoutCustomerId !== customerId)) {
      return invalidEvent('Invalid subscription customer')
    }

    const purchasedPlan = getPurchasedPlan(subscription)
    if (!purchasedPlan) return invalidEvent('Unsupported subscription price')

    const accountState = getAccountState(subscription.status, purchasedPlan)
    if (!accountState) return invalidEvent('Unsupported subscription status')

    const failure = await persistEvent({
      supabase,
      accountId,
      customerId,
      subscriptionId,
      plan: accountState.plan,
      status: accountState.status,
      eventCreated: event.created,
      eventId: event.id,
      eventType: event.type,
      leaseOwner,
    })
    if (failure) return failure
  } catch (error) {
    console.error('[stripe/webhook] processing failed', error)
    return NextResponse.json({ error: 'Failed to process Stripe event' }, { status: 500 })
  } finally {
    if (leaseAcquired && supabase) {
      try {
        const { error: releaseError } = await supabase.rpc(
          'release_stripe_subscription_lease',
          {
            p_subscription_id: subscriptionId,
            p_lease_owner: leaseOwner,
          },
        )
        if (releaseError) {
          console.error('[stripe/webhook] lease release failed', releaseError)
        }
      } catch (releaseError) {
        console.error('[stripe/webhook] lease release failed', releaseError)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
