import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

function getPlan(priceId: string): 'basic' | 'pro' | 'enterprise' {
  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) return 'enterprise'
  if (priceId === process.env.STRIPE_PRICE_PRO)        return 'pro'
  if (priceId === process.env.STRIPE_PRICE_BASIC)      return 'basic'
  return 'basic'
}

// accounts.status has a CHECK constraint allowing exactly:
//   'active' | 'past_due' | 'cancelled' | 'trialing'
// Stripe's Subscription.Status has EIGHT values, five of which violate it —
// note especially Stripe's `canceled` (one L) vs our `cancelled` (two L).
// Writing sub.status straight through raises a CheckViolation, which the
// handler now (correctly) turns into a 500 — so Stripe would retry a
// `customer.subscription.updated` for ~3 days and fail every single time.
// `incomplete` fires on essentially every SCA/3DS signup and `canceled` on
// every cancellation, so this is a routine path, not an edge case.
function getStatus(stripeStatus: string): 'active' | 'past_due' | 'cancelled' | 'trialing' {
  switch (stripeStatus) {
    case 'active':
    case 'past_due':
    case 'trialing':
      return stripeStatus
    // Owes money / initial payment never completed — not entitled, not dead.
    case 'incomplete':
    case 'unpaid':
      return 'past_due'
    // Terminal or access-suspended states collapse to cancelled: the schema
    // has no 'paused', and denying access is the fail-safe direction.
    case 'canceled':
    case 'incomplete_expired':
    case 'paused':
      return 'cancelled'
    default:
      // Unknown future Stripe status — never let it reach the CHECK.
      console.warn(`[stripe/webhook] unmapped subscription status "${stripeStatus}" — storing as past_due`)
      return 'past_due'
  }
}

// Retry contract with Stripe (this is the whole point of the handler):
//   400 — signature could not be verified. Stripe does not retry; correct,
//         because a forged/misconfigured delivery will never become valid.
//   200 — the event was applied, OR it is well-formed but deliberately
//         ignored (unknown event.type, checkout session without an
//         account_id, subscription event with no subscription id). Stripe
//         stops delivering. Never return 200 for a write we could not make.
//   500 — the database write failed. Stripe retries with backoff for ~3 days,
//         which is what saves a paid upgrade from being silently dropped.
//
// The previous implementation used supabase-js, which resolves to
// `{ data, error }` instead of throwing. The result was discarded, so every
// failed write still fell through to a 200 and Stripe never retried.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature') ?? ''

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const sql = db()

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as {
        metadata?: { account_id?: string } | null
        customer?: string | null
        subscription?: string | null
      }
      const accountId = session.metadata?.account_id
      if (!accountId) {
        // Well-formed event we cannot act on (e.g. a checkout not started by
        // this app). Retrying would never help, so ack it.
        console.warn(`[stripe/webhook] ${event.id} ${event.type}: session has no account_id metadata — ignoring`)
        return NextResponse.json({ ok: true, handled: false })
      }

      // Upsert keyed on the account id makes a Stripe redelivery of this
      // event a no-op rewrite of identical values, so at-least-once delivery
      // is safe here.
      await sql`
        insert into accounts (id, stripe_customer_id, stripe_subscription_id, plan, status)
        values (${accountId}, ${session.customer ?? null}, ${session.subscription ?? null}, 'pro', 'active')
        on conflict (id) do update set
          stripe_customer_id     = excluded.stripe_customer_id,
          stripe_subscription_id = excluded.stripe_subscription_id,
          plan                   = excluded.plan,
          status                 = excluded.status
      `
      return NextResponse.json({ ok: true })
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as {
        id: string
        status: string
        items?: { data?: { price?: { id?: string } }[] }
      }
      const priceId = sub.items?.data?.[0]?.price?.id ?? ''
      const rows = await sql`
        update accounts
           set plan = ${getPlan(priceId)}, status = ${getStatus(sub.status)}
         where stripe_subscription_id = ${sub.id}
        returning id
      `
      if (rows.length === 0) {
        console.warn(`[stripe/webhook] ${event.id} ${event.type}: no account for subscription ${sub.id}`)
      }
      return NextResponse.json({ ok: true })
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as { id: string }
      const rows = await sql`
        update accounts
           set plan = 'basic', status = 'cancelled'
         where stripe_subscription_id = ${sub.id}
        returning id
      `
      if (rows.length === 0) {
        console.warn(`[stripe/webhook] ${event.id} ${event.type}: no account for subscription ${sub.id}`)
      }
      return NextResponse.json({ ok: true })
    }

    if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object as unknown as { subscription?: string | null }
      const subscriptionId = inv.subscription
      if (!subscriptionId) {
        // One-off (non-subscription) invoice — nothing to downgrade. Ack it.
        console.warn(`[stripe/webhook] ${event.id} ${event.type}: invoice has no subscription — ignoring`)
        return NextResponse.json({ ok: true, handled: false })
      }
      const rows = await sql`
        update accounts
           set status = 'past_due'
         where stripe_subscription_id = ${subscriptionId}
        returning id
      `
      if (rows.length === 0) {
        console.warn(`[stripe/webhook] ${event.id} ${event.type}: no account for subscription ${subscriptionId}`)
      }
      return NextResponse.json({ ok: true })
    }
  } catch (err) {
    // The only path that must return 5xx: the event was valid and we intended
    // to write, but the write failed. Stripe will redeliver.
    console.error(`[stripe/webhook] db write failed for event ${event.id} (${event.type}):`, err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // Residual idempotency risk (deliberately not solved with a new table):
  // Stripe does not guarantee ordering, and these writes are last-write-wins
  // with no event-timestamp guard. A redelivered or out-of-order
  // `checkout.session.completed` can therefore re-assert plan='pro' /
  // status='active' over a newer `customer.subscription.updated` or
  // `.deleted`. Each handler is individually idempotent (upsert on id;
  // UPDATEs set constant/event-derived values), so replaying the *same* event
  // is safe — only cross-event ordering can regress state. Fixing that
  // properly needs a monotonic guard (e.g. `where excluded.event_created_at >
  // accounts.stripe_event_created_at`), which is a schema change outside this
  // fix's scope.
  console.warn(`[stripe/webhook] unhandled event type ${event.type} (${event.id}) — acking`)
  return NextResponse.json({ ok: true, handled: false })
}
