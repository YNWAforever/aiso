import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { stripe, STRIPE_PRICES } from '@/lib/stripe'
import { db } from '@/lib/db'
import { mirrorOneOffInvoice } from '@/lib/billing/invoices'
import {
  getPlanFromStripePrice,
  type CheckoutPlanId as Plan,
} from '@/lib/plans/catalog'

export const dynamic = 'force-dynamic'

type AccountStatus = 'active' | 'past_due' | 'cancelled' | 'trialing'
type PersistenceOutcome = 'applied' | 'duplicate' | 'stale' | 'not_found' | 'lease_lost'
type Sql = ReturnType<typeof db>

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

const ONE_OFF_INVOICE_EVENTS = new Set([
  'invoice.finalized', 'invoice.paid', 'invoice.payment_failed', 'invoice.voided', 'invoice.marked_uncollectible',
])

function invoiceSubscriptionId(object: Record<string, unknown>): string | null {
  const parent = object.parent as { subscription_details?: { subscription?: unknown } } | null | undefined
  return stripeId(parent?.subscription_details?.subscription) ?? stripeId(object.subscription)
}

async function handleOneOffInvoiceEvent(event: { type: string; data: { object: unknown } }): Promise<Response | null> {
  if (!ONE_OFF_INVOICE_EVENTS.has(event.type)) return null
  const object = event.data.object as Record<string, unknown>
  if (invoiceSubscriptionId(object)) return null
  const stripeInvoiceId = stripeId(object.id)
  if (!stripeInvoiceId) return invalidEvent('Invalid invoice id')
  const metadata = object.metadata as { source?: unknown } | undefined
  const issued = metadata?.source === 'aiso_admin_one_off'
  try {
    const result = await mirrorOneOffInvoice(stripeInvoiceId, { issued })
    if (result.status === 'ok' || (result.status === 'not_found' && !issued)) return NextResponse.json({ ok: true })
    return retryableLeaseResponse('Could not reconcile the invoice')
  } catch {
    console.error('[stripe/webhook] one-off invoice persistence failed')
    return NextResponse.json({ error: 'Failed to update invoice status' }, { status: 500 })
  }
}

function planForPrice(priceId: string): Plan | null {
  return getPlanFromStripePrice(priceId, STRIPE_PRICES)
}

function getPurchasedPlan(subscription: CanonicalSubscription): Plan | null {
  const items = subscription.items?.data
  if (!Array.isArray(items) || items.length === 0) return null

  // Per-fix billing (migration 107) adds a metered item beside the plan item on
  // an admin-opened account. That item is deliberately ignored here: the plan
  // still comes from the one plan-priced item. 0 or 2+ plan-priced items stay a
  // refusal rather than a guess — a subscription the webhook cannot attribute
  // must not be allowed to rewrite entitlements.
  const plans = items
    .map(item => planForPrice(item?.price?.id ?? ''))
    .filter((plan): plan is Plan => plan !== null)
  return plans.length === 1 ? plans[0]! : null
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
  if (eventType === 'invoice.payment_failed') return invoiceSubscriptionId(object)
  if (eventType === 'checkout.session.completed') {
    return stripeId(object.subscription)
  }
  return stripeId(object.id)
}

async function persistEvent(args: {
  sql: Sql
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
  const rows = await args.sql`
    select apply_stripe_account_event(
      p_account_id      => ${args.accountId}::uuid,
      p_subscription_id => ${args.subscriptionId},
      p_customer_id     => ${args.customerId},
      p_plan            => ${args.plan},
      p_status          => ${args.status},
      p_event_created   => ${args.eventCreated}::bigint,
      p_event_id        => ${args.eventId},
      p_event_type      => ${args.eventType},
      p_lease_owner     => ${args.leaseOwner}::uuid
    ) as result
  `
  const outcome = rows[0]?.result as PersistenceOutcome | undefined

  if (outcome === 'not_found') {
    return NextResponse.json({ error: 'Stripe account linkage is not ready' }, { status: 503 })
  }
  if (outcome === 'lease_lost') {
    return retryableLeaseResponse('Stripe subscription processing lease was lost')
  }
  if (outcome === 'applied' || outcome === 'duplicate' || outcome === 'stale') {
    return null
  }

  console.error('[stripe/webhook] unexpected persistence outcome', outcome)
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

  // One-off invoices (model C) have no subscription and update their own mirror.
  // Handled before the lifecycle branch so a one-off invoice.payment_failed is
  // not mistaken for a subscription event.
  const oneOffResponse = await handleOneOffInvoiceEvent(event)
  if (oneOffResponse) return oneOffResponse

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
  let sql: Sql | null = null

  try {
    sql = db()
    const acquireRows = await sql`
      select acquire_stripe_subscription_lease(
        p_subscription_id => ${subscriptionId},
        p_lease_owner     => ${leaseOwner}::uuid
      ) as acquired
    `
    const acquired = acquireRows[0]?.acquired

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
      sql,
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
    if (leaseAcquired && sql) {
      try {
        await sql`
          select release_stripe_subscription_lease(
            p_subscription_id => ${subscriptionId},
            p_lease_owner     => ${leaseOwner}::uuid
          ) as released
        `
      } catch (releaseError) {
        console.error('[stripe/webhook] lease release failed', releaseError)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
