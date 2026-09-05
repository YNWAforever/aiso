import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'
import { CHECKOUT_PLAN_IDS, PLAN_CATALOG } from '@/lib/plans/catalog'
import * as catalogModule from '@/lib/plans/catalog'
import enMessages from '@/messages/en.json'
import zhMessages from '@/messages/zh-HK.json'

const pricingSource = readFileSync(
  resolve(process.cwd(), 'app/[lang]/(marketing)/pricing/page.tsx'),
  'utf8',
)
const cardHighlightsSource = pricingSource.slice(
  pricingSource.indexOf('const cardHighlights'),
  pricingSource.indexOf('return (', pricingSource.indexOf('const cardHighlights')),
)

describe('pricing billing truth', () => {
  it('renders paid prices from the catalog instead of duplicated literals', () => {
    expect(CHECKOUT_PLAN_IDS.map(id => PLAN_CATALOG[id].monthlyPriceUsd)).toEqual([199, 599, 999])
    expect(pricingSource).toContain('getPlanDefinition')
    expect(pricingSource).not.toMatch(/price:\s*['"]\$\d+(?:\.\d+)?['"]/)
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
    expect(enMessages.pricing.enterprise_custom_body).toContain('contractual SLA')
    expect(enMessages.pricing.enterprise_custom_body).toContain('custom quotas')
    expect(zhMessages.pricing.enterprise_custom_body).toContain('API')
    expect(zhMessages.pricing.enterprise_custom_body).toContain('SSO')
    expect(zhMessages.pricing.enterprise_custom_body).toContain('合約 SLA')
    expect(zhMessages.pricing.enterprise_custom_body).toContain('客製配額')
    expect(cardHighlightsSource).not.toMatch(
      /enterprise_custom|row_api|row_custom_platforms|SSO|API|SLA|quota|dedicated/i,
    )
    expect(pricingSource).toContain('mailto:aeo@fimmick.com')
  })

  it('labels released online reports and unreleased PDF honestly in both locales', () => {
    expect(PLAN_CATALOG.pro.release.clientReports).toBe('available')
    expect(PLAN_CATALOG.enterprise.release.clientReports).toBe('available')
    expect(PLAN_CATALOG.enterprise.release.whiteLabelPdf).toBe('planned')
    expect(enMessages.pricing.coming_soon).toBe('Coming soon')
    expect(zhMessages.pricing.coming_soon).toBe('即將推出')
    expect(enMessages.pricing.allowance_scans_fair_use).toContain('Fair-use')
    expect(zhMessages.pricing.allowance_scans_fair_use).toContain('合理使用')
  })

  it('does not imply an upgrade unlocks Coming soon features', () => {
    expect(enMessages.pricing.faq_3_a).toContain('currently available')
    expect(enMessages.pricing.faq_3_a).toContain('Coming soon')
    expect(enMessages.pricing.faq_3_a).not.toContain('new features activate immediately')
    expect(zhMessages.pricing.faq_3_a).toContain('目前已提供')
    expect(zhMessages.pricing.faq_3_a).toContain('即將推出')
    expect(zhMessages.pricing.faq_3_a).not.toContain('新功能即時生效')
  })

  it('never renders a bare tick for a capability that is entitled but not shipped', () => {
    // The gap this pins: a plan can grant an entitlement flag while the feature
    // itself has not shipped. Prompt bank and Share-of-Voice alerts were both
    // entitled on Pro/Enterprise and hardcoded `pro: true, enterprise: true` in
    // the comparison table, so a paying customer saw a green tick for two route
    // families that answered 503. Entitlement is not availability.
    for (const plan of ['pro', 'enterprise'] as const) {
      expect(PLAN_CATALOG[plan].features.edit_prompts).toBe(true)
      expect(PLAN_CATALOG[plan].features.alerts).toBe(true)
      // sovAlerts has since shipped: evaluate-alerts now has a GET handler and
      // a weekly cron (vercel.json), so it is legitimately 'available'. (promptBank
      // shipped earlier and is pinned by the dedicated test below instead of here.)
      // The structural checks below still guard the actual invariant this test
      // is named for — the page must derive each tick from release state rather
      // than a hardcoded literal — so a future entitled-but-unshipped capability
      // is still caught.
      expect(PLAN_CATALOG[plan].release.sovAlerts).toBe('available')
    }

    // …and the page must derive each row from release state rather than a
    // literal, so flipping the catalog is the only way to tick them. Prompt
    // bank and Share-of-Voice alerts are now both 'available' on Pro, so this
    // loop also covers row_monitoring and row_competitor — both still
    // 'planned' on Pro — to keep exercising a row whose current claim is
    // "not available" rather than one that would coincidentally pass even if
    // someone hardcoded it.
    const guardedRows: ReadonlyArray<{
      row: string
      releaseKey: string
      checkPro: boolean
      checkEnterprise: boolean
    }> = [
      { row: 'row_prompts', releaseKey: 'promptBank', checkPro: true, checkEnterprise: true },
      { row: 'row_alerts', releaseKey: 'sovAlerts', checkPro: true, checkEnterprise: true },
      { row: 'row_monitoring', releaseKey: 'monitoring', checkPro: true, checkEnterprise: true },
      // row_competitor's Enterprise cell reads features.agent_competitors (an
      // entitlement flag), not a release key — only Pro is release-gated here.
      { row: 'row_competitor', releaseKey: 'competitorSummary', checkPro: true, checkEnterprise: false },
    ]

    for (const { row, releaseKey, checkPro, checkEnterprise } of guardedRows) {
      const cell = pricingSource.slice(
        pricingSource.indexOf(`label: t('${row}')`),
        pricingSource.indexOf('}', pricingSource.indexOf(`label: t('${row}')`)),
      )
      expect(cell).toContain(`release.${releaseKey}`)
      if (checkPro) expect(cell).not.toMatch(/pro:\s*true/)
      if (checkEnterprise) expect(cell).not.toMatch(/enterprise:\s*true/)
    }

    // The Pro card highlight has to be gated too — it listed both unqualified.
    expect(cardHighlightsSource).toContain('releaseHighlight(pro.release.promptBank')
    expect(cardHighlightsSource).toContain('releaseHighlight(pro.release.sovAlerts')
  })

  it('only claims the prompt bank is available while it is actually reachable', () => {
    // The tick is honest only because a page renders the editor. If that page
    // ever goes back to redirecting at the "unavailable" placeholder — which is
    // exactly what it did before — this claim silently becomes a lie again.
    // Ties the marketing state to the implementation rather than to a comment.
    const claimsAvailable = (['pro', 'enterprise'] as const)
      .some(plan => PLAN_CATALOG[plan].release.promptBank === 'available')
    if (!claimsAvailable) return

    const page = readFileSync(
      resolve(process.cwd(), 'app/[lang]/dashboard/[clientId]/prompts/page.tsx'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

    // Asserts the property, not the component: the page must render the bank
    // rather than redirect. Naming one component pinned an implementation
    // detail and broke when the suggest panel was wired back in.
    expect(page).toMatch(/PromptBankEditor|QuestionBankSection/)
    expect(page).not.toContain('redirect(')

    // And the routes serving it must not be fenced.
    const fenced = readFileSync(
      resolve(process.cwd(), '__tests__/api/fenced-routes.test.ts'), 'utf8',
    )
    expect(fenced).not.toContain("feature: 'prompt-bank'")
  })

  it('provides one catalog-derived localized allowance projection for pricing', () => {
    const projection = (
      catalogModule as unknown as { buildPricingAllowanceProjection?: unknown }
    ).buildPricingAllowanceProjection

    expect(projection).toBeTypeOf('function')
  })

  it.each([
    ['en', enMessages],
    ['zh-HK', zhMessages],
  ] as const)('projects every %s checkout allowance from the catalog', (locale, messages) => {
    const pricing = messages.pricing as Record<string, string>
    for (const key of [
      'allowance_scans_monthly',
      'allowance_scans_fair_use',
      'allowance_brands',
      'allowance_history_weeks',
      'allowance_history_lifetime',
    ]) {
      expect(pricing).toHaveProperty(key)
    }

    const translate = createTranslator({ locale, messages, namespace: 'pricing' })
    const format: catalogModule.PricingAllowanceFormatter = (key, values) =>
      translate(key as never, values as never)

    for (const plan of CHECKOUT_PLAN_IDS) {
      const definition = PLAN_CATALOG[plan]
      const projection = catalogModule.buildPricingAllowanceProjection(plan, format)

      if (definition.monthlyScanLimit === null) {
        expect(projection.scans).toBe(pricing.allowance_scans_fair_use)
      } else {
        expect(projection.scans).toContain(String(definition.monthlyScanLimit))
      }
      expect(projection.brands).toContain(String(definition.maxBrands))
      if (definition.historyWeeks === null) {
        expect(projection.history).toBe(pricing.allowance_history_lifetime)
      } else {
        expect(projection.history).toContain(String(definition.historyWeeks))
      }
    }
  })

  it('removes per-plan allowance strings and uses the catalog projection on Pricing', () => {
    for (const messages of [enMessages, zhMessages]) {
      const pricing = messages.pricing as Record<string, string>
      for (const key of [
        'row_scans_s', 'row_scans_p', 'row_scans_e',
        'row_brands_s', 'row_brands_p', 'row_brands_e',
        'row_history_s', 'row_history_p', 'row_history_e',
      ]) {
        expect(pricing).not.toHaveProperty(key)
      }
    }
    expect(pricingSource).toContain('buildPricingAllowanceProjection')
    expect(pricingSource).not.toMatch(/row_(scans|brands|history)_[spe]/)
  })

  it('localizes Enterprise as a starting price while Basic and Pro stay monthly', () => {
    const enPricing = enMessages.pricing as Record<string, string>
    const zhPricing = zhMessages.pricing as Record<string, string>
    expect(enPricing.starting_price_per_month).toBe('/month starting price')
    expect(zhPricing.starting_price_per_month).toBe('/月起')
    expect(pricingSource).toContain(
      "key === 'enterprise' ? t('starting_price_per_month') : t('per_month')",
    )
  })

  it('keeps monthly-only checkout and locale parity', () => {
    expect(enMessages.pricing.per_month).toBe('/mo')
    expect(zhMessages.pricing.per_month).toBe('/月')
    expect(JSON.stringify(enMessages.pricing)).not.toMatch(/annual|yearly/i)
    expect(JSON.stringify(zhMessages.pricing)).not.toMatch(/年繳|按年/)
    expect(Object.keys(enMessages.pricing).sort()).toEqual(Object.keys(zhMessages.pricing).sort())
  })
})
