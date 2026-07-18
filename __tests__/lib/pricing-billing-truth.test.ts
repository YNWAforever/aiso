import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import enMessages from '@/messages/en.json'
import zhMessages from '@/messages/zh-HK.json'

describe('pricing billing truth', () => {
  it('names the current paid tiers in the public pricing FAQ', () => {
    expect(enMessages.pricing.faq_1_a).not.toMatch(/\bStarter\b/i)
    expect(zhMessages.pricing.faq_1_a).not.toContain('入門版')
    expect(enMessages.pricing.faq_1_a).toContain('Basic')
    expect(zhMessages.pricing.faq_1_a).toContain('基本版')
  })

  it('advertises only the monthly prices supported by the single checkout price per plan', () => {
    const pricingSource = readFileSync(
      resolve(process.cwd(), 'app/[lang]/pricing/page.tsx'),
      'utf8',
    )
    const stripeSource = readFileSync(resolve(process.cwd(), 'lib/stripe.ts'), 'utf8')

    expect(pricingSource).toContain("body: JSON.stringify({ plan: planName, lang })")
    expect(pricingSource).toContain("price: '$29'")
    expect(pricingSource).toContain("price: '$79'")
    expect(pricingSource).toContain("price: '$199'")
    expect(pricingSource).not.toMatch(/\bannual\b/i)
    expect(pricingSource).not.toContain('role="switch"')

    expect(stripeSource.match(/STRIPE_PRICE_(BASIC|PRO|ENTERPRISE)/g)).toEqual([
      'STRIPE_PRICE_BASIC',
      'STRIPE_PRICE_PRO',
      'STRIPE_PRICE_ENTERPRISE',
    ])
    expect(enMessages.pricing.per_month).toBe('/mo')
    expect(zhMessages.pricing.per_month).toBe('/月')
    expect(JSON.stringify(enMessages.pricing)).not.toMatch(/annual|yearly/i)
    expect(JSON.stringify(zhMessages.pricing)).not.toMatch(/按年|年繳/)
  })
})
