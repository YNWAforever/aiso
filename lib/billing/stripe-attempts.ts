import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { getPlanDefinition, type CheckoutPlanId } from '@/lib/plans/catalog'

type BasePayload = { customerId: string; plan: CheckoutPlanId; priceId: string }
type CheckoutPayload = BasePayload & { lang: 'en' | 'zh-HK'; origin: string }
type AdminPayload = BasePayload & { meteredPriceId: string; daysUntilDue: number }
type AttemptInput = { kind: 'checkout'; payload: CheckoutPayload } | { kind: 'admin'; payload: AdminPayload }
export type SubscriptionAttempt = AttemptInput & { id: string; startedAt: string; stripeObjectId: string | null }

export type SubscriptionLease = {
  attempt: SubscriptionAttempt | null
  start: (input: AttemptInput) => Promise<SubscriptionAttempt>
  record: (attempt: SubscriptionAttempt, stripeObjectId: string) => Promise<void>
  clear: (attempt: SubscriptionAttempt) => Promise<void>
}

export async function matchesCatalogPrice(priceId: string, plan: CheckoutPlanId): Promise<boolean> {
  const price = await stripe.prices.retrieve(priceId)
  return price.active && price.currency === 'usd' && price.unit_amount === getPlanDefinition(plan).monthlyPriceUsd * 100
    && price.recurring?.interval === 'month' && price.recurring.interval_count === 1
    && price.recurring.usage_type === 'licensed'
}

export function canRetryStripeCreate(startedAt: string | Date) {
  return Date.now() - new Date(startedAt).getTime() < 23 * 60 * 60 * 1000
}

export function isTerminalSubscription(status: string) {
  return status === 'canceled' || status === 'incomplete_expired'
}

export async function retrieveCheckoutAttempt(attempt: SubscriptionAttempt) {
  if (attempt.stripeObjectId) return stripe.checkout.sessions.retrieve(attempt.stripeObjectId)
  const sessions = await stripe.checkout.sessions.list({
    customer: attempt.payload.customerId,
    created: { gte: Math.floor(new Date(attempt.startedAt).getTime() / 1000) - 60 },
    limit: 100,
  })
  const session = sessions.data.find(item => item.metadata?.aiso_operation === attempt.id)
  if (!session && sessions.has_more) throw new Error('Checkout history needs reconciliation')
  return session ?? null
}

/** Short database writes serialize the two subscription entry points across processes. */
export async function withSubscriptionLease<T>(accountId: string, run: (lease: SubscriptionLease) => Promise<T>): Promise<T | null> {
  const sql = db()
  const owner = randomUUID()
  const [row] = await sql`
    insert into stripe_subscription_attempts (account_id, lease_owner, lease_until)
    select id, ${owner}::uuid, clock_timestamp() + interval '5 minutes' from accounts where id = ${accountId}::uuid
    on conflict (account_id) do update set lease_owner = excluded.lease_owner, lease_until = excluded.lease_until
    where stripe_subscription_attempts.lease_until is null or stripe_subscription_attempts.lease_until <= clock_timestamp()
    returning operation_id, kind, payload, stripe_object_id, started_at
  `
  if (!row) return null
  const stillOwned = (rows: unknown[]) => {
    if (rows.length !== 1) throw new Error('Subscription attempt lease expired')
  }

  try {
    const attempt = row.operation_id ? {
      id: row.operation_id,
      kind: row.kind,
      payload: row.payload,
      startedAt: row.started_at,
      stripeObjectId: row.stripe_object_id,
    } as SubscriptionAttempt : null
    return await run({
      attempt,
      async start(input) {
        const id = randomUUID()
        const rows = await sql`
          update stripe_subscription_attempts set operation_id = ${id}::uuid, kind = ${input.kind},
            payload = ${JSON.stringify(input.payload)}::jsonb, started_at = clock_timestamp()
          where account_id = ${accountId}::uuid and lease_owner = ${owner}::uuid
            and lease_until > clock_timestamp() and operation_id is null
          returning started_at
        `
        stillOwned(rows)
        return { ...input, id, startedAt: rows[0].started_at, stripeObjectId: null }
      },
      async record(operation, stripeObjectId) {
        stillOwned(await sql`
          update stripe_subscription_attempts set stripe_object_id = ${stripeObjectId}
          where account_id = ${accountId}::uuid and lease_owner = ${owner}::uuid
            and lease_until > clock_timestamp() and operation_id = ${operation.id}::uuid
            and (stripe_object_id is null or stripe_object_id = ${stripeObjectId})
          returning operation_id
        `)
      },
      async clear(operation) {
        stillOwned(await sql`
          update stripe_subscription_attempts set operation_id = null, kind = null, payload = null,
            stripe_object_id = null, started_at = null
          where account_id = ${accountId}::uuid and lease_owner = ${owner}::uuid
            and lease_until > clock_timestamp() and operation_id = ${operation.id}::uuid
          returning account_id
        `)
      },
    })
  } finally {
    try {
      await sql`update stripe_subscription_attempts set lease_owner = null, lease_until = null
        where account_id = ${accountId}::uuid and lease_owner = ${owner}::uuid`
    } catch {
      console.error('[billing] subscription lease release failed')
    }
  }
}
