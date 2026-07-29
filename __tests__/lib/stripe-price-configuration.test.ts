import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// lib/stripe.ts builds STRIPE_PRICES once, at module load, from
// process.env.STRIPE_PRICE_*. To exercise both a configured and an unset
// price we have to stub the env *before* importing the module and force a
// fresh module instance each time — a top-level `import` would only ever see
// whatever was in the environment at the first import across this file.
async function loadStripeModule() {
  vi.resetModules()
  return import('@/lib/stripe')
}

describe('lib/stripe price configuration', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_PRICE_BASIC', undefined)
    vi.stubEnv('STRIPE_PRICE_PRO', undefined)
    vi.stubEnv('STRIPE_PRICE_ENTERPRISE', undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('makes every plan unpurchasable when no STRIPE_PRICE_* vars are configured', async () => {
    const { isPlanPurchasable, STRIPE_PRICES } = await loadStripeModule()

    expect(isPlanPurchasable('basic')).toBe(false)
    expect(isPlanPurchasable('pro')).toBe(false)
    expect(isPlanPurchasable('enterprise')).toBe(false)
    expect(STRIPE_PRICES).toEqual({
      basic: undefined,
      pro: undefined,
      enterprise: undefined,
    })
  })

  it('treats only the plan with a non-empty price id as purchasable', async () => {
    vi.stubEnv('STRIPE_PRICE_BASIC', 'price_basic_live')
    vi.stubEnv('STRIPE_PRICE_PRO', '')

    const { isPlanPurchasable } = await loadStripeModule()

    expect(isPlanPurchasable('basic')).toBe(true)
    expect(isPlanPurchasable('pro')).toBe(false)
    expect(isPlanPurchasable('enterprise')).toBe(false)
  })

  it('purchasable once every price id is configured', async () => {
    vi.stubEnv('STRIPE_PRICE_BASIC', 'price_basic_live')
    vi.stubEnv('STRIPE_PRICE_PRO', 'price_pro_live')
    vi.stubEnv('STRIPE_PRICE_ENTERPRISE', 'price_enterprise_live')

    const { isPlanPurchasable } = await loadStripeModule()

    expect(isPlanPurchasable('basic')).toBe(true)
    expect(isPlanPurchasable('pro')).toBe(true)
    expect(isPlanPurchasable('enterprise')).toBe(true)
  })
})
