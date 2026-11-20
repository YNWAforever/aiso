import { APP_URL, stripe, STRIPE_PRICES } from '@/lib/stripe'
import type { CheckoutPlanId } from '@/lib/plans/catalog'
import { ensureStripeCustomer, loadBillingAccount } from './accounts'
import { canRetryStripeCreate, isTerminalSubscription, matchesCatalogPrice, retrieveCheckoutAttempt, withSubscriptionLease } from './stripe-attempts'

export type CheckoutOutcome =
  | { status: 'ok'; url: string }
  | { status: 'billing_exists' | 'checkout_pending' | 'checkout_unavailable' }

export async function openCheckout(accountId: string, plan: CheckoutPlanId, lang: 'en' | 'zh-HK'): Promise<CheckoutOutcome> {
  const result = await withSubscriptionLease<CheckoutOutcome>(accountId, async lease => {
    const account = await loadBillingAccount(accountId)
    if (!account) return { status: 'checkout_unavailable' }
    if (account.stripe_subscription_id) {
      const subscription = await stripe.subscriptions.retrieve(account.stripe_subscription_id)
      if (!isTerminalSubscription(subscription.status)) return { status: 'billing_exists' }
    }

    let attempt = lease.attempt
    if (attempt?.kind === 'admin') {
      if (!attempt.stripeObjectId) return { status: 'checkout_pending' }
      const subscription = await stripe.subscriptions.retrieve(attempt.stripeObjectId)
      if (!isTerminalSubscription(subscription.status)) return { status: 'billing_exists' }
      await lease.clear(attempt)
      attempt = null
    }

    if (attempt?.kind === 'checkout') {
      const session = await retrieveCheckoutAttempt(attempt)
      if (session) {
        await lease.record(attempt, session.id)
        if (session.status === 'complete') {
          const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
          if (!subscriptionId || !isTerminalSubscription((await stripe.subscriptions.retrieve(subscriptionId)).status)) {
            return { status: 'checkout_pending' }
          }
        } else if (session.status === 'open') {
          if (attempt.payload.plan === plan && attempt.payload.lang === lang && session.url) {
            return { status: 'ok', url: session.url }
          }
          const expired = await stripe.checkout.sessions.expire(session.id, {}, { idempotencyKey: `aiso:checkout:${attempt.id}:expire` })
          if (expired.status !== 'expired') return { status: 'checkout_pending' }
        } else if (session.status !== 'expired') {
          return { status: 'checkout_pending' }
        }
        await lease.clear(attempt)
        attempt = null
      } else if (attempt.payload.plan !== plan || attempt.payload.lang !== lang || !canRetryStripeCreate(attempt.startedAt)) {
        return { status: 'checkout_pending' }
      }
    }

    if (!attempt) {
      const priceId = STRIPE_PRICES[plan]
      if (!priceId || !await matchesCatalogPrice(priceId, plan)) return { status: 'checkout_unavailable' }

      const customer = await ensureStripeCustomer(account)
      if (customer.status !== 'ok') return { status: 'checkout_unavailable' }
      const subscriptions = await stripe.subscriptions.list({ customer: customer.customerId, status: 'all', limit: 100 })
      if (subscriptions.has_more || subscriptions.data.some(item => !isTerminalSubscription(item.status))) {
        return { status: 'billing_exists' }
      }
      const sessions = await stripe.checkout.sessions.list({ customer: customer.customerId, status: 'open', limit: 1 })
      if (sessions.data.length) return { status: 'checkout_pending' }
      attempt = await lease.start({ kind: 'checkout', payload: { customerId: customer.customerId, plan, priceId, lang, origin: APP_URL } })
    }

    if (attempt.kind !== 'checkout') return { status: 'checkout_pending' }
    const { customerId, priceId, origin, lang: attemptLang, plan: attemptPlan } = attempt.payload
    const metadata = { account_id: accountId, plan: attemptPlan, aiso_operation: attempt.id }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customerId,
      client_reference_id: accountId,
      locale: attemptLang,
      metadata,
      subscription_data: { metadata },
      success_url: `${origin}/${attemptLang}/dashboard`,
      cancel_url: `${origin}/${attemptLang}/pricing?plan=${attemptPlan}`,
    }, { idempotencyKey: `aiso:checkout:${attempt.id}` })
    await lease.record(attempt, session.id)
    return session.status === 'open' && session.url
      ? { status: 'ok', url: session.url }
      : { status: 'checkout_pending' }
  })
  return result ?? { status: 'checkout_pending' }
}
