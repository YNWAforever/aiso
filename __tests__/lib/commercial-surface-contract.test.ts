import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHECKOUT_PLAN_IDS, PLAN_CATALOG } from '@/lib/plans/catalog'
import { getPlanFeatures, maxBrandsForPlan } from '@/lib/tier'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function sourceSection(contents: string, start: string, end: string) {
  const startIndex = contents.indexOf(start)
  const endIndex = contents.indexOf(end, startIndex)

  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)

  return contents.slice(startIndex, endIndex)
}

describe('commercial surface contract', () => {
  it.each(CHECKOUT_PLAN_IDS)('keeps %s catalog and compatibility values aligned', plan => {
    const definition = PLAN_CATALOG[plan]
    expect(getPlanFeatures(plan)).toBe(definition.features)
    expect(maxBrandsForPlan(plan)).toBe(definition.maxBrands)
  })

  it('validates the checkout plan through the catalog before looking up a Stripe price', () => {
    const checkout = source('app/api/stripe/checkout/route.ts')
    const planDecision = checkout.indexOf('const plan = getCheckoutPlanId(body.plan)')
    const priceLookup = checkout.indexOf('const priceId = STRIPE_PRICES[plan]')

    expect(planDecision).toBeGreaterThanOrEqual(0)
    expect(priceLookup).toBeGreaterThan(planDecision)
    expect(checkout.slice(planDecision, priceLookup)).toContain('if (!plan)')
    expect(checkout).not.toMatch(/const VALID_PLANS\s*=/)
  })

  it('resolves the canonical webhook price before persisting entitlements', () => {
    const webhook = source('app/api/stripe/webhook/route.ts')
    const priceResolver = webhook.indexOf('return getPlanFromStripePrice(')
    const purchasedPlan = webhook.indexOf('const purchasedPlan = getPurchasedPlan(subscription)')
    const persistence = webhook.indexOf('const failure = await persistEvent({')

    expect(priceResolver).toBeGreaterThanOrEqual(0)
    expect(purchasedPlan).toBeGreaterThan(priceResolver)
    expect(persistence).toBeGreaterThan(purchasedPlan)
    expect(webhook).not.toMatch(/function getPlan\(priceId/)
  })

  it('keeps secret-backed Stripe prices outside the client-safe catalog', () => {
    const catalog = source('lib/plans/catalog.ts')
    const stripe = source('lib/stripe.ts')

    expect(catalog).not.toMatch(/process\.env|STRIPE_PRICE_|@\/lib\/stripe|next\//)
    expect(stripe).toContain("import type { CheckoutPlanId } from '@/lib/plans/catalog'")
    expect(stripe).toMatch(/export const STRIPE_PRICES:\s*ConfiguredStripePrices/)
    for (const plan of CHECKOUT_PLAN_IDS) {
      expect(stripe).toMatch(new RegExp(`${plan}:\\s*process\\.env\\.STRIPE_PRICE_${plan.toUpperCase()}`))
    }
  })

  // The interactive pricing body lives in components/pricing/PricingPage.tsx —
  // app/[lang]/pricing/page.tsx is a thin Server Component that only resolves
  // per-plan purchasability (see the split described in the activation-path
  // design doc, §6). These three tests pin the client component's source,
  // repointed from the old page.tsx location; every assertion below is
  // unchanged from before the split.
  it('constructs self-serve pricing from catalog definitions and excludes Custom-only card promises', () => {
    const pricing = source('components/pricing/PricingPage.tsx')
    const plans = sourceSection(pricing, 'const plans = CHECKOUT_PLAN_IDS.map', 'const cardHighlights')
    const cardHighlights = sourceSection(pricing, 'const cardHighlights', 'return (')

    expect(plans).toContain('getPlanDefinition(key)')
    expect(plans).toContain('definition.monthlyPriceUsd')
    expect(pricing).not.toMatch(/price:\s*['\"]\$(29|79|199)['\"]/)
    expect(cardHighlights).not.toMatch(
      /enterprise_custom|row_api|row_custom_platforms|\b(API|SSO|SLA|quota|dedicated customer success|custom AI platforms)\b/i,
    )
  })

  it('routes every displayed checkout allowance through the catalog projection', () => {
    const pricing = source('components/pricing/PricingPage.tsx')
    const messages = [source('messages/en.json'), source('messages/zh-HK.json')]

    expect(pricing).toContain('buildPricingAllowanceProjection(key')
    expect(pricing).not.toMatch(/row_(scans|brands|history)_[spe]/)
    for (const plan of CHECKOUT_PLAN_IDS) {
      for (const allowance of ['scans', 'brands', 'history']) {
        expect(pricing).toContain(`allowances.${plan}.${allowance}`)
      }
    }
    for (const localeMessages of messages) {
      expect(localeMessages).not.toMatch(/"row_(scans|brands|history)_[spe]"/)
    }
  })

  it('uses client navigation for localized login and a full-page Stripe redirect', () => {
    const pricing = source('components/pricing/PricingPage.tsx')

    expect(pricing).toContain("import { useParams, useRouter } from 'next/navigation'")
    expect(pricing).toContain('const router = useRouter()')
    expect(pricing).toContain('router.push(`/${lang}/auth/login?next=/${lang}/pricing`)')
    expect(pricing).toContain('window.location.assign(data.url)')
    expect(pricing).not.toContain('window.location.href')
  })

  it('resolves purchasability server-side and renders an unavailable state for an unpurchasable plan', () => {
    const page = source('app/[lang]/pricing/page.tsx')
    const pricing = source('components/pricing/PricingPage.tsx')

    // The Server Component computes purchasable[] from lib/stripe.ts and never
    // imports a price id or secret into what it hands to the client component.
    expect(page).toContain("import { isPlanPurchasable } from '@/lib/stripe'")
    expect(page).toContain('isPlanPurchasable(plan)')
    expect(page).not.toContain('STRIPE_PRICES')
    expect(page).not.toContain('priceId')

    // The client component disables checkout and shows the unavailable copy
    // instead of a live Buy button when a plan isn't purchasable.
    expect(pricing).toContain("purchasable[key] === true")
    expect(pricing).toContain("disabled={loading || !plan.purchasable}")
    expect(pricing).toContain("t('cta_unavailable')")
    expect(pricing).toContain("t('plan_unavailable_note')")
  })
})
