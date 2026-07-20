import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHECKOUT_PLAN_IDS, PLAN_CATALOG } from '@/lib/plans/catalog'
import { getPlanFeatures, maxBrandsForPlan } from '@/lib/tier'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('commercial surface contract', () => {
  it.each(CHECKOUT_PLAN_IDS)('keeps %s catalog and compatibility values aligned', plan => {
    const definition = PLAN_CATALOG[plan]
    expect(getPlanFeatures(plan)).toBe(definition.features)
    expect(maxBrandsForPlan(plan)).toBe(definition.maxBrands)
  })

  it('routes checkout and webhook plan decisions through the catalog', () => {
    const checkout = source('app/api/stripe/checkout/route.ts')
    const webhook = source('app/api/stripe/webhook/route.ts')

    expect(checkout).toContain('getCheckoutPlanId')
    expect(checkout).not.toMatch(/const VALID_PLANS\s*=/)
    expect(webhook).toContain('getPlanFromStripePrice')
    expect(webhook).not.toMatch(/function getPlan\(priceId/)
  })

  it('keeps secret-backed Stripe prices outside the client-safe catalog', () => {
    const catalog = source('lib/plans/catalog.ts')
    const stripe = source('lib/stripe.ts')

    expect(catalog).not.toMatch(/process\.env|STRIPE_PRICE_|@\/lib\/stripe|next\//)
    expect(stripe.match(/STRIPE_PRICE_(BASIC|PRO|ENTERPRISE)/g)).toEqual([
      'STRIPE_PRICE_BASIC',
      'STRIPE_PRICE_PRO',
      'STRIPE_PRICE_ENTERPRISE',
    ])
  })

  it('keeps Pricing free of duplicated monthly price literals', () => {
    const pricing = source('app/[lang]/pricing/page.tsx')
    expect(pricing).toContain('getPlanDefinition')
    expect(pricing).not.toMatch(/price:\s*['\"]\$(29|79|199)['\"]/)
  })
})
