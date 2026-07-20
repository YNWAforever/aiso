import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHECKOUT_PLAN_IDS, PLAN_CATALOG } from '@/lib/plans/catalog'
import enMessages from '@/messages/en.json'
import zhMessages from '@/messages/zh-HK.json'

const pricingSource = readFileSync(
  resolve(process.cwd(), 'app/[lang]/pricing/page.tsx'),
  'utf8',
)

describe('pricing billing truth', () => {
  it('renders paid prices from the catalog instead of duplicated literals', () => {
    expect(CHECKOUT_PLAN_IDS.map(id => PLAN_CATALOG[id].monthlyPriceUsd)).toEqual([29, 79, 199])
    expect(pricingSource).toContain('getPlanDefinition')
    expect(pricingSource).not.toMatch(/price:\s*['"]\$(29|79|199)['"]/)
    expect(pricingSource).toContain("body: JSON.stringify({ plan: planName, lang })")
  })

  it('does not sell Custom-only capabilities as self-serve Enterprise features', () => {
    expect(PLAN_CATALOG.enterprise.release).toMatchObject({
      publicApi: 'custom',
      customPlatforms: 'custom',
      dedicatedSuccess: 'custom',
    })
    expect(enMessages.pricing.enterprise_custom_body).toContain('API')
    expect(enMessages.pricing.enterprise_custom_body).toContain('SSO')
    expect(zhMessages.pricing.enterprise_custom_body).toContain('API')
    expect(zhMessages.pricing.enterprise_custom_body).toContain('SSO')
    expect(pricingSource).toContain('mailto:aeo@fimmick.com')
  })

  it('labels unreleased reports honestly in both locales', () => {
    expect(PLAN_CATALOG.pro.release.clientReports).toBe('planned')
    expect(PLAN_CATALOG.enterprise.release.whiteLabelPdf).toBe('planned')
    expect(enMessages.pricing.coming_soon).toBe('Coming soon')
    expect(zhMessages.pricing.coming_soon).toBe('即將推出')
    expect(enMessages.pricing.row_scans_p).toContain('Fair-use')
    expect(enMessages.pricing.row_scans_e).toContain('Fair-use')
    expect(zhMessages.pricing.row_scans_p).toContain('合理使用')
    expect(zhMessages.pricing.row_scans_e).toContain('合理使用')
  })

  it('keeps monthly-only checkout and locale parity', () => {
    expect(enMessages.pricing.per_month).toBe('/mo')
    expect(zhMessages.pricing.per_month).toBe('/月')
    expect(JSON.stringify(enMessages.pricing)).not.toMatch(/annual|yearly/i)
    expect(JSON.stringify(zhMessages.pricing)).not.toMatch(/年繳|按年/)
    expect(Object.keys(enMessages.pricing).sort()).toEqual(Object.keys(zhMessages.pricing).sort())
  })
})
