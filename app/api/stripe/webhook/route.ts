import { NextRequest, NextResponse } from 'next/server'
import { stripe, STRIPE_PRICES } from '@/lib/stripe'
import { createServiceSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

type Plan = 'basic' | 'pro' | 'enterprise'
const VALID_PLANS: readonly Plan[] = ['basic', 'pro', 'enterprise']

function parsePlan(value: unknown): Plan | null {
  return typeof value === 'string' && VALID_PLANS.includes(value as Plan)
    ? value as Plan
    : null
}

function getPlan(priceId: string): Plan | null {
  if (priceId === STRIPE_PRICES.enterprise) return 'enterprise'
  if (priceId === STRIPE_PRICES.pro) return 'pro'
  if (priceId === STRIPE_PRICES.basic) return 'basic'
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

async function persistenceResult(operation: PromiseLike<{ error: unknown }>) {
  const { error } = await operation
  if (!error) return null
  console.error('[stripe/webhook] persistence failed', error)
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as {
      metadata?: { account_id?: string; plan?: string }
      customer?: unknown
      subscription?: unknown
    }
    const accountId = session.metadata?.account_id
    const plan = parsePlan(session.metadata?.plan)
    const customerId = stripeId(session.customer)
    const subscriptionId = stripeId(session.subscription)
    if (!accountId || !plan || !customerId || !subscriptionId) {
      return invalidEvent('Invalid checkout metadata')
    }

    const supabase = await createServiceSupabaseClient()
    const failure = await persistenceResult(supabase.from('accounts').upsert({
      id: accountId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      plan,
      status: 'active',
    }))
    if (failure) return failure
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as {
      id: string
      status: string
      items: { data: Array<{ price: { id: string } }> }
    }
    const plan = getPlan(sub.items.data[0]?.price?.id ?? '')
    if (!plan) return invalidEvent('Unsupported subscription price')

    const supabase = await createServiceSupabaseClient()
    const failure = await persistenceResult(supabase
      .from('accounts')
      .update({ plan, status: sub.status })
      .eq('stripe_subscription_id', sub.id))
    if (failure) return failure
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as { id: string }
    const supabase = await createServiceSupabaseClient()
    const failure = await persistenceResult(supabase
      .from('accounts')
      .update({ plan: 'basic', status: 'cancelled' })
      .eq('stripe_subscription_id', sub.id))
    if (failure) return failure
  }

  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object as { subscription?: unknown }
    const subscriptionId = stripeId(inv.subscription)
    if (!subscriptionId) return invalidEvent('Invalid invoice subscription')

    const supabase = await createServiceSupabaseClient()
    const failure = await persistenceResult(supabase
      .from('accounts')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', subscriptionId))
    if (failure) return failure
  }

  return NextResponse.json({ ok: true })
}
