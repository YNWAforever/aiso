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

export const APP_URL = appOrigin()
