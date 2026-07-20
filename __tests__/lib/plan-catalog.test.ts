import { describe, expect, it } from 'vitest'
import {
  CHECKOUT_PLAN_IDS,
  PLAN_CATALOG,
  getCheckoutPlanId,
  getPlanDefinition,
  getPlanFromStripePrice,
  type StripePriceMap,
} from '@/lib/plans/catalog'

const prices: StripePriceMap = {
  basic: 'price_basic_test',
  pro: 'price_pro_test',
  enterprise: 'price_enterprise_test',
}

describe('Plan Catalog', () => {
  it('defines the three self-serve paid plans in display order', () => {
    expect(CHECKOUT_PLAN_IDS).toEqual(['basic', 'pro', 'enterprise'])
    expect(CHECKOUT_PLAN_IDS.map(id => PLAN_CATALOG[id].monthlyPriceUsd)).toEqual([29, 79, 199])
  })

  it('keeps canonical allowances aligned with legacy feature fields', () => {
    for (const plan of Object.values(PLAN_CATALOG)) {
      expect(plan.features.plan).toBe(plan.id)
      expect(plan.features.max_brands).toBe(plan.maxBrands)
      expect(plan.features.history_weeks).toBe(plan.historyWeeks ?? 999)
    }
  })

  it('captures the approved Pro and Enterprise target boundaries without claiming release', () => {
    expect(PLAN_CATALOG.pro).toMatchObject({
      maxBrands: 3,
      historyWeeks: 26,
      monthlyScanLimit: null,
      competitorMode: 'summary',
      reportBranding: 'fimmick',
      supportLevel: 'standard',
    })
    expect(PLAN_CATALOG.pro.release).toMatchObject({
      monitoring: 'planned',
      competitorSummary: 'planned',
      clientReports: 'planned',
    })
    expect(PLAN_CATALOG.enterprise).toMatchObject({
      maxBrands: 10,
      historyWeeks: null,
      competitorMode: 'full',
      reportBranding: 'white-label',
      supportLevel: 'priority',
    })
    expect(PLAN_CATALOG.enterprise.release).toMatchObject({
      whiteLabelPdf: 'planned',
      publicApi: 'custom',
      customPlatforms: 'custom',
      dedicatedSuccess: 'custom',
    })
  })

  it('fails closed for unknown plans and excludes Free from checkout', () => {
    expect(getPlanDefinition('unexpected').id).toBe('free')
    expect(getPlanDefinition(null).id).toBe('free')
    expect(getCheckoutPlanId('free')).toBeNull()
    expect(getCheckoutPlanId('pro')).toBe('pro')
    expect(getCheckoutPlanId({})).toBeNull()
  })

  it('maps a canonical Stripe price to exactly one paid plan', () => {
    expect(getPlanFromStripePrice('price_basic_test', prices)).toBe('basic')
    expect(getPlanFromStripePrice('price_pro_test', prices)).toBe('pro')
    expect(getPlanFromStripePrice('price_enterprise_test', prices)).toBe('enterprise')
    expect(getPlanFromStripePrice('price_unknown', prices)).toBeNull()
  })

  it('rejects ambiguous or missing Stripe price mappings', () => {
    expect(getPlanFromStripePrice('', prices)).toBeNull()
    expect(getPlanFromStripePrice('same', {
      basic: 'same',
      pro: 'same',
      enterprise: 'price_enterprise_test',
    })).toBeNull()
  })
})
