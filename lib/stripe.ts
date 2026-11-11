import Stripe from 'stripe'
import { appOrigin } from '@/lib/app-origin'
import type { StripePriceMap } from '@/lib/plans/catalog'

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

export const STRIPE_PRICES: StripePriceMap = {
  basic:      process.env.STRIPE_PRICE_BASIC!,
  pro:        process.env.STRIPE_PRICE_PRO!,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE!,
}

// Per-fix billing is opt-in per account and fails closed: an unset price or
// meter event name must never fall back to a charge, it must leave the usage
// row failed for the admin to see (docs/superpowers/specs/
// 2026-11-11-per-fix-billing-design.md).
export function fixPackMeterConfig(): { priceId: string; eventName: string } {
  return {
    priceId: process.env.STRIPE_PRICE_FIX_METERED ?? '',
    eventName: process.env.STRIPE_FIX_METER_EVENT_NAME ?? '',
  }
}

export const APP_URL = appOrigin()
