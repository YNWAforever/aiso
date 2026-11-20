import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { fixPackMeterConfig, invoiceDaysUntilDue, stripe, STRIPE_PRICES } from '@/lib/stripe'
import { getPlanFromStripePrice, type CheckoutPlanId } from '@/lib/plans/catalog'
import { canRetryStripeCreate, isTerminalSubscription, matchesCatalogPrice, retrieveCheckoutAttempt, withSubscriptionLease, type SubscriptionLease } from './stripe-attempts'

/**
 * Admin billing controls, model B (metered per-fix billing). Design:
 * docs/superpowers/specs/2026-11-11-per-fix-billing-design.md.
 *
 * The platform administrator opens an account's billing here: reuse/create the
 * Stripe customer, attach the metered price to the account's plan subscription
 * (or, explicitly, create that subscription), and upsert the `account_billing`
 * control row. This is the only writer of `account_billing` mode.
 *
 * Nothing here reports usage or charges per fix pack — that is
 * lib/billing/usage.ts — and opening billing never changes entitlements except
 * through the guarded apply_stripe_account_event path, whose job is exactly
 * that (plan/status columns). Failures are returned as explicit outcomes, never
 * as a success response over a failed write.
 */

export type BillingMode = 'included' | 'metered'

export type AccountBillingRow = {
  accountId: string
  stripeCustomerId: string
  stripeSubscriptionId: string | null
  stripeMeteredItemId: string | null
  mode: BillingMode
  openedBy: string
  openedAt: string | Date
  updatedAt: string | Date
}

export type OpenBillingOutcome =
  | { status: 'ok'; billing: AccountBillingRow }
  | { status: 'account_not_found' }
  | { status: 'metered_not_configured' }
  | { status: 'subscription_required' }
  | { status: 'stripe_failed'; code: string }
  | { status: 'account_link_failed' }

export type OpenBillingInput = {
  accountId: string
  mode: BillingMode
  /** Plan used only when the admin also asks to create the subscription. */
  plan?: CheckoutPlanId
  /** Explicit opt-in: create a send-invoice plan subscription when none exists. */
  createSubscription?: boolean
  openedBy: string
}

export type BillingAccountLookup = {
  id: string
  plan: string
  status: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  owner_email: string | null
}

export type CustomerOutcome =
  | { status: 'ok'; customerId: string }
  | { status: 'stripe_failed'; code: string }

type StripeSubscriptionShape = {
  id: string
  status: string
  customer?: unknown
  items?: { data?: Array<{ id: string; price?: { id?: string } }> }
}

/** One account, with the owner's auth email used only when creating a customer. */
export async function loadBillingAccount(accountId: string): Promise<BillingAccountLookup | null> {
  const rows = await db()`
    select
      a.id, a.plan, a.status, a.stripe_customer_id, a.stripe_subscription_id,
      (
        select u.email
        from profiles p
        join neon_auth."user" u on u.id = p.id
        where p.account_id = a.id and p.deactivated_at is null
        order by p.created_at
        limit 1
      ) as owner_email
    from accounts a
    where a.id = ${accountId}::uuid
    limit 1
  `
  return (rows[0] as BillingAccountLookup | undefined) ?? null
}

/** Recover the same provider request after a lost response or a failed link. */
export async function ensureStripeCustomer(account: BillingAccountLookup): Promise<CustomerOutcome> {
  if (account.stripe_customer_id) return { status: 'ok', customerId: account.stripe_customer_id }

  const sql = db()
  try {
    const [, , [attempt]] = await sql.transaction([
      sql`select id from accounts where id = ${account.id}::uuid for update`,
      sql`insert into stripe_customer_attempts (account_id, email)
          select id, ${account.owner_email} from accounts
          where id = ${account.id}::uuid and stripe_customer_id is null
          on conflict (account_id) do nothing`,
      sql`select a.stripe_customer_id, c.email, c.started_at
          from accounts a left join stripe_customer_attempts c on c.account_id = a.id
          where a.id = ${account.id}::uuid`,
    ])
    if (attempt?.stripe_customer_id) return { status: 'ok', customerId: String(attempt.stripe_customer_id) }
    if (!attempt?.started_at) return { status: 'stripe_failed', code: 'CUSTOMER_LINK_FAILED' }

    let customerId: string
    if (canRetryStripeCreate(attempt.started_at)) {
      const customer = await stripe.customers.create({
        email: attempt.email == null ? undefined : String(attempt.email),
        metadata: { account_id: account.id, source: 'aiso_account_customer' },
      }, { idempotencyKey: `aiso:customer:${account.id}` })
      customerId = customer.id
    } else {
      const matches = await stripe.customers.search({
        query: `metadata['account_id']:'${account.id}' AND metadata['source']:'aiso_account_customer'`,
        limit: 2,
      })
      if (matches.data.length !== 1 || matches.has_more) {
        return { status: 'stripe_failed', code: 'CUSTOMER_RECONCILIATION_REQUIRED' }
      }
      customerId = matches.data[0].id
    }

    const [[linked]] = await sql.transaction([
      sql`update accounts set stripe_customer_id = coalesce(stripe_customer_id, ${customerId})
          where id = ${account.id}::uuid returning stripe_customer_id`,
      sql`delete from stripe_customer_attempts c using accounts a
          where c.account_id = ${account.id}::uuid and a.id = c.account_id and a.stripe_customer_id is not null`,
    ])
    if (linked?.stripe_customer_id) return { status: 'ok', customerId: String(linked.stripe_customer_id) }
    return { status: 'stripe_failed', code: 'CUSTOMER_LINK_FAILED' }
  } catch {
    console.error('[billing] customer request or link failed')
    return { status: 'stripe_failed', code: 'CUSTOMER_CREATE_FAILED' }
  }
}

export async function loadAccountBilling(accountId: string): Promise<AccountBillingRow | null> {
  const rows = await db()`
    select account_id, stripe_customer_id, stripe_subscription_id,
           stripe_metered_item_id, mode, opened_by, opened_at, updated_at
    from account_billing
    where account_id = ${accountId}::uuid
    limit 1
  `
  return mapBillingRow(rows[0] as Record<string, unknown> | undefined)
}

function mapBillingRow(row: Record<string, unknown> | undefined): AccountBillingRow | null {
  if (!row) return null
  return {
    accountId: row.account_id as string,
    stripeCustomerId: row.stripe_customer_id as string,
    stripeSubscriptionId: (row.stripe_subscription_id as string | null) ?? null,
    stripeMeteredItemId: (row.stripe_metered_item_id as string | null) ?? null,
    mode: row.mode as BillingMode,
    openedBy: row.opened_by as string,
    openedAt: row.opened_at as string | Date,
    updatedAt: row.updated_at as string | Date,
  }
}

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due'])
const ACCOUNT_STATUS_BY_STRIPE_STATUS: Record<string, 'active' | 'past_due' | 'cancelled' | 'trialing'> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  incomplete: 'past_due',
  incomplete_expired: 'cancelled',
  canceled: 'cancelled',
  unpaid: 'past_due',
  paused: 'cancelled',
}

async function retrieveSubscription(id: string): Promise<StripeSubscriptionShape | null> {
  try {
    const subscription = await stripe.subscriptions.retrieve(id)
    return subscription as unknown as StripeSubscriptionShape
  } catch (error) {
    console.error(
      '[billing] subscription retrieve failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return null
  }
}

function subscriptionItems(subscription: StripeSubscriptionShape) {
  return subscription.items?.data ?? []
}

function meteredItemIn(
  subscription: StripeSubscriptionShape,
  meteredPriceId: string,
): { id: string } | null {
  return subscriptionItems(subscription).find(item => item.price?.id === meteredPriceId) ?? null
}

/**
 * Reject a subscription whose paid lines are not exactly plan prices or the
 * configured metered price. A subscription carrying anything unexpected must
 * not be silently modified, because getPurchasedPlan would then resolve it as a
 * guess (see app/api/stripe/webhook/route.ts).
 */
function hasUnexpectedItems(subscription: StripeSubscriptionShape, meteredPriceId: string): boolean {
  return subscriptionItems(subscription).some(item => {
    const priceId = item.price?.id ?? ''
    if (priceId === meteredPriceId) return false
    return getPlanFromStripePrice(priceId, STRIPE_PRICES) === null
  })
}

function isResourceMissing(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'resource_missing'
  )
}

/**
 * Link an admin-created subscription to its account through the guarded event
 * path. A raw UPDATE would bypass the event ledger, the lease and the stale
 * ordering that the Stripe webhook depends on. The attempt stays recoverable
 * when the link cannot yet be confirmed.
 */
async function linkSubscriptionToAccount(args: {
  accountId: string
  subscriptionId: string
  customerId: string
  plan: CheckoutPlanId
}): Promise<boolean> {
  const leaseOwner = randomUUID()
  const sql = db()
  try {
    const acquiredRows = await sql`
      select acquire_stripe_subscription_lease(
        p_subscription_id => ${args.subscriptionId},
        p_lease_owner     => ${leaseOwner}::uuid
      ) as acquired
    `
    if (acquiredRows[0]?.acquired !== true) return false

    try {
      const canonical = await stripe.subscriptions.retrieve(args.subscriptionId)
      const accountStatus = ACCOUNT_STATUS_BY_STRIPE_STATUS[canonical.status]
      const planPrices = canonical.items.data.map(item => getPlanFromStripePrice(item.price.id, STRIPE_PRICES)).filter(Boolean)
      const customerId = typeof canonical.customer === 'string' ? canonical.customer : canonical.customer?.id
      if (!accountStatus || canonical.id !== args.subscriptionId || customerId !== args.customerId
        || planPrices.length !== 1 || planPrices[0] !== args.plan) return false
      const rows = await sql`
        select apply_stripe_account_event(
          p_account_id      => ${args.accountId}::uuid,
          p_subscription_id => ${args.subscriptionId},
          p_customer_id     => ${args.customerId},
          p_plan            => ${args.plan},
          p_status          => ${accountStatus},
          p_event_created   => ${Math.floor(Date.now() / 1000)}::bigint,
          p_event_id        => ${`adminbilling:${randomUUID()}`},
          p_event_type      => 'admin.billing.open',
          p_lease_owner     => ${leaseOwner}::uuid
        ) as result
      `
      const outcome = rows[0]?.result
      if (outcome === 'applied') return true
      if (outcome !== 'duplicate' && outcome !== 'stale') return false
      const current = await loadBillingAccount(args.accountId)
      return current?.stripe_subscription_id === args.subscriptionId && current.stripe_customer_id === args.customerId
    } finally {
      try {
        await sql`
          select release_stripe_subscription_lease(
            p_subscription_id => ${args.subscriptionId},
            p_lease_owner     => ${leaseOwner}::uuid
          ) as released
        `
      } catch (releaseError) {
        console.error('[billing] admin lease release failed', releaseError)
      }
    }
  } catch (error) {
    console.error(
      '[billing] admin subscription link failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return false
  }
}

async function upsertAccountBilling(args: {
  accountId: string
  customerId: string
  subscriptionId: string | null
  meteredItemId: string | null
  mode: BillingMode
  openedBy: string
}): Promise<OpenBillingOutcome> {
  try {
    const rows = await db()`
      insert into account_billing (
        account_id, stripe_customer_id, stripe_subscription_id,
        stripe_metered_item_id, mode, opened_by
      )
      values (
        ${args.accountId}::uuid, ${args.customerId}, ${args.subscriptionId},
        ${args.meteredItemId}, ${args.mode}, ${args.openedBy}::uuid
      )
      on conflict (account_id) do update
        set stripe_customer_id = excluded.stripe_customer_id,
            stripe_subscription_id = excluded.stripe_subscription_id,
            stripe_metered_item_id = excluded.stripe_metered_item_id,
            mode = excluded.mode,
            updated_at = now()
      returning account_id, stripe_customer_id, stripe_subscription_id,
                stripe_metered_item_id, mode, opened_by, opened_at, updated_at
    `
    const billing = mapBillingRow(rows[0] as Record<string, unknown> | undefined)
    if (!billing) return { status: 'stripe_failed', code: 'BILLING_UPSERT_FAILED' }
    return { status: 'ok', billing }
  } catch (error) {
    console.error(
      '[billing] account billing upsert failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return { status: 'stripe_failed', code: 'BILLING_UPSERT_FAILED' }
  }
}

/**
 * Ensure the account's plan subscription carries the metered item, attaching it
 * (or creating the whole subscription when explicitly requested and none
 * exists). Returns the metered item id on success.
 */
async function ensureMeteredItem(args: {
  account: BillingAccountLookup
  customerId: string
  plan: CheckoutPlanId
  createSubscription: boolean
  lease: SubscriptionLease
}): Promise<
  | { status: 'ok'; subscriptionId: string | null; meteredItemId: string }
  | { status: 'metered_not_configured' }
  | { status: 'subscription_required' }
  | { status: 'account_link_failed' }
  | { status: 'stripe_failed'; code: string }
> {
  const { priceId: meteredPriceId } = fixPackMeterConfig()
  if (!meteredPriceId) return { status: 'metered_not_configured' }

  const linkedId = args.account.stripe_subscription_id
  const linkedSubscription = linkedId ? await retrieveSubscription(linkedId) : null
  if (linkedId && !linkedSubscription) return { status: 'stripe_failed', code: 'SUBSCRIPTION_LOOKUP_FAILED' }
  if (linkedSubscription && !isTerminalSubscription(linkedSubscription.status)) {
    const subscription = linkedSubscription
    if (!ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      return { status: 'stripe_failed', code: 'SUBSCRIPTION_INACTIVE' }
    }
    if (hasUnexpectedItems(subscription, meteredPriceId)) {
      return { status: 'stripe_failed', code: 'SUBSCRIPTION_ITEMS_UNSUPPORTED' }
    }

    const existing = meteredItemIn(subscription, meteredPriceId)
    if (existing) {
      return { status: 'ok', subscriptionId: subscription.id, meteredItemId: existing.id }
    }

    try {
      // Metered prices must not carry a quantity: Stripe rejects
      // `quantity` for them ("You cannot set the quantity for metered
      // plans"), and the unit is the meter event, not a seat count.
      const created = await stripe.subscriptionItems.create({
        subscription: subscription.id,
        price: meteredPriceId,
      })
      return { status: 'ok', subscriptionId: subscription.id, meteredItemId: created.id }
    } catch (error) {
      console.error(
        '[billing] metered item attach failed:',
        error instanceof Error ? error.message : 'unknown error',
      )
      return { status: 'stripe_failed', code: 'METERED_ITEM_ATTACH_FAILED' }
    }
  }

  if (!args.createSubscription) return { status: 'subscription_required' }

  let attempt = args.lease.attempt
  if (attempt?.kind === 'checkout') {
    const session = await retrieveCheckoutAttempt(attempt)
    if (!session || (session.status !== 'expired' && session.status !== 'complete')) {
      return { status: 'stripe_failed', code: 'CHECKOUT_PENDING' }
    }
    if (session.status === 'complete') {
      const id = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      if (!id || !isTerminalSubscription((await stripe.subscriptions.retrieve(id)).status)) {
        return { status: 'stripe_failed', code: 'CHECKOUT_PENDING' }
      }
    }
    await args.lease.clear(attempt)
    attempt = null
  }

  try {
    let subscription: StripeSubscriptionShape | undefined
    if (attempt) {
      if (attempt.payload.plan !== args.plan || attempt.payload.customerId !== args.customerId) {
        return { status: 'stripe_failed', code: 'SUBSCRIPTION_RECONCILIATION_REQUIRED' }
      }
      if (attempt.stripeObjectId) {
        subscription = await stripe.subscriptions.retrieve(attempt.stripeObjectId)
      } else {
        const subscriptions = await stripe.subscriptions.list({ customer: args.customerId, status: 'all', limit: 100 })
        subscription = subscriptions.data.find(item => item.metadata.aiso_operation === attempt?.id)
        if (!subscription && (subscriptions.has_more || !canRetryStripeCreate(attempt.startedAt))) {
          return { status: 'stripe_failed', code: 'SUBSCRIPTION_RECONCILIATION_REQUIRED' }
        }
      }
      if (subscription && isTerminalSubscription(subscription.status)) {
        await args.lease.clear(attempt)
        attempt = null
        subscription = undefined
      }
    }
    if (!attempt) {
      const priceId = STRIPE_PRICES[args.plan]
      if (!priceId) return { status: 'stripe_failed', code: 'PLAN_PRICE_MISSING' }
      if (!await matchesCatalogPrice(priceId, args.plan)) return { status: 'stripe_failed', code: 'PLAN_PRICE_MISMATCH' }
      const subscriptions = await stripe.subscriptions.list({ customer: args.customerId, status: 'all', limit: 100 })
      const sessions = await stripe.checkout.sessions.list({ customer: args.customerId, status: 'open', limit: 1 })
      if (subscriptions.has_more || subscriptions.data.some(item => !isTerminalSubscription(item.status)) || sessions.data.length) {
        return { status: 'stripe_failed', code: 'SUBSCRIPTION_RECONCILIATION_REQUIRED' }
      }
      attempt = await args.lease.start({ kind: 'admin', payload: {
        customerId: args.customerId, plan: args.plan, priceId, meteredPriceId, daysUntilDue: invoiceDaysUntilDue(),
      } })
    }
    if (attempt.kind !== 'admin') return { status: 'stripe_failed', code: 'CHECKOUT_PENDING' }

    const payload = attempt.payload
    subscription ??= await stripe.subscriptions.create({
      customer: payload.customerId,
      items: [{ price: payload.priceId }, { price: payload.meteredPriceId }],
      collection_method: 'send_invoice',
      days_until_due: payload.daysUntilDue,
      metadata: { account_id: args.account.id, source: 'aiso_admin_billing_open', aiso_operation: attempt.id },
    }, { idempotencyKey: `aiso:admin-subscription:${attempt.id}` })
    await args.lease.record(attempt, subscription.id)

    const meteredItem = meteredItemIn(subscription, payload.meteredPriceId)
    if (!meteredItem) return { status: 'stripe_failed', code: 'METERED_ITEM_MISSING' }
    const linked = await linkSubscriptionToAccount({
      accountId: args.account.id, subscriptionId: subscription.id, customerId: payload.customerId,
      plan: payload.plan,
    })
    if (!linked) return { status: 'account_link_failed' }
    return { status: 'ok', subscriptionId: subscription.id, meteredItemId: meteredItem.id }
  } catch {
    console.error('[billing] subscription creation or recovery failed')
    return { status: 'stripe_failed', code: 'SUBSCRIPTION_CREATE_FAILED' }
  }
}

/**
 * Detach the metered item when switching back to `included`. The ledger rows
 * stay — they record what was billable at the time — but no new pack is
 * reported because storeFixPack only records usage when mode = 'metered'.
 */
async function detachMeteredItem(
  account: BillingAccountLookup,
): Promise<{ status: 'ok' } | { status: 'stripe_failed'; code: string }> {
  const existing = await loadAccountBilling(account.id)
  let itemId = existing?.stripeMeteredItemId ?? null

  if (!itemId && account.stripe_subscription_id) {
    const priceId = fixPackMeterConfig().priceId
    if (priceId) {
      const subscription = await retrieveSubscription(account.stripe_subscription_id)
      if (!subscription) return { status: 'stripe_failed', code: 'SUBSCRIPTION_LOOKUP_FAILED' }
      itemId = meteredItemIn(subscription, priceId)?.id ?? null
    }
  }

  if (!itemId) return { status: 'ok' }

  try {
    await stripe.subscriptionItems.del(itemId)
    return { status: 'ok' }
  } catch (error) {
    if (isResourceMissing(error)) return { status: 'ok' }
    console.error(
      '[billing] metered item detach failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return { status: 'stripe_failed', code: 'METERED_ITEM_DETACH_FAILED' }
  }
}

/**
 * Open or change an account's billing mode. Idempotent: ids are reused and a
 * repeated call only rewrites the mode.
 */
export async function openAccountBilling(input: OpenBillingInput): Promise<OpenBillingOutcome> {
  try {
    const result = await withSubscriptionLease(input.accountId, lease => updateAccountBilling(input, lease))
    if (result) return result
    return await loadBillingAccount(input.accountId)
      ? { status: 'stripe_failed', code: 'BILLING_OPERATION_PENDING' }
      : { status: 'account_not_found' }
  } catch {
    console.error('[billing] account billing operation failed')
    return { status: 'stripe_failed', code: 'BILLING_OPERATION_FAILED' }
  }
}

async function updateAccountBilling(input: OpenBillingInput, lease: SubscriptionLease): Promise<OpenBillingOutcome> {
  const account = await loadBillingAccount(input.accountId)
  if (!account) return { status: 'account_not_found' }

  const customer = await ensureStripeCustomer(account)
  if (customer.status !== 'ok') return customer

  if (input.mode === 'included') {
    const detached = await detachMeteredItem(account)
    if (detached.status !== 'ok') return detached
    return upsertAccountBilling({
      accountId: account.id,
      customerId: customer.customerId,
      subscriptionId: account.stripe_subscription_id,
      meteredItemId: null,
      mode: 'included',
      openedBy: input.openedBy,
    })
  }

  const metered = await ensureMeteredItem({
    account,
    customerId: customer.customerId,
    plan: input.plan ?? 'basic',
    createSubscription: input.createSubscription === true,
    lease,
  })
  if (metered.status !== 'ok') return metered

  return upsertAccountBilling({
    accountId: account.id,
    customerId: customer.customerId,
    subscriptionId: metered.subscriptionId,
    meteredItemId: metered.meteredItemId,
    mode: 'metered',
    openedBy: input.openedBy,
  })
}
