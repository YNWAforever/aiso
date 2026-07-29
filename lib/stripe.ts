import Stripe from 'stripe'
import type { CheckoutPlanId } from '@/lib/plans/catalog'

// Lazy singleton — defer new Stripe() until first use so that
// module evaluation at Next.js build time (when STRIPE_SECRET_KEY
// may be absent) does not throw "Neither apiKey nor config.authenticator provided".
let _stripe: Stripe | null = null

export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop: string | symbol) {
    if (!_stripe) {
      _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2026-04-22.dahlia',
      })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_stripe as any)[prop]
  },
})

// A plan is "configured" only once its Stripe price id is set — with none of
// the three STRIPE_PRICE_* vars populated, every entry here is undefined and
// every plan is unpurchasable. Partial (not StripePriceMap) is the honest type:
// the reverse mapping in lib/plans/catalog.ts keeps the non-partial type for its
// own signature, but the environment-sourced map must be able to say "unset".
export type ConfiguredStripePrices = Partial<Record<CheckoutPlanId, string>>

export const STRIPE_PRICES: ConfiguredStripePrices = {
  basic:      process.env.STRIPE_PRICE_BASIC,
  pro:        process.env.STRIPE_PRICE_PRO,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
}

// A plan is purchasable only when its Stripe price id is a non-empty string.
// Checkout and the pricing page both derive from this single answer so
// neither can drift into promising a plan the other refuses to sell.
export function isPlanPurchasable(plan: CheckoutPlanId): boolean {
  return typeof STRIPE_PRICES[plan] === 'string' && STRIPE_PRICES[plan] !== ''
}

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://fimmick-aeo.vercel.app'
