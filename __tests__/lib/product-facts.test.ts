import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'
import { buildPricingAllowanceProjection, PLAN_CATALOG } from '@/lib/plans/catalog'
import { PRODUCT_FACTS, getLocalizedProductFacts } from '@/lib/product-facts'
import enMessages from '@/messages/en.json'
import zhMessages from '@/messages/zh-HK.json'

describe('PRODUCT_FACTS', () => {
  it('uses the approved five-platform claim everywhere', () => {
    expect(PRODUCT_FACTS.platforms).toEqual([
      'ChatGPT',
      'Google AI',
      'Perplexity',
      'Claude',
      'Gemini',
    ])
    expect(PRODUCT_FACTS.platforms).toHaveLength(5)
  })

  it('defines the core Fix Pack without marketing drift', () => {
    expect(PRODUCT_FACTS.fixPack).toEqual([
      'llms.txt',
      'robots.txt patch',
      'FAQ JSON-LD',
    ])
  })

  it('keeps critical English and Hong Kong Chinese facts aligned', () => {
    const en = getLocalizedProductFacts('en')
    const zh = getLocalizedProductFacts('zh-HK')
    expect(en.platformCount).toBe(zh.platformCount)
    expect(en.checkCount).toBe(zh.checkCount)
    expect(en.fixPack).toEqual(zh.fixPack)
  })

  it('keeps pricing Fix Pack claims exact in both locales', () => {
    expect(enMessages.pricing.row_fixpack).toBe(
      'Fix Pack (llms.txt · robots.txt patch · FAQ JSON-LD)',
    )
    expect(zhMessages.pricing.row_fixpack).toBe(
      '修復包（llms.txt · robots.txt 修補檔 · FAQ JSON-LD）',
    )
  })

  it('describes the released report as an attributed online report in both locales', () => {
    expect(enMessages.pricing.row_client_report).toBe(
      'Online client report with Fimmick AISO attribution',
    )
    expect(zhMessages.pricing.row_client_report).toBe(
      '附 Fimmick AISO 署名的網上客戶報告',
    )
    expect(enMessages.pricing.row_client_report).not.toMatch(/pdf|white[- ]label/i)
    expect(zhMessages.pricing.row_client_report).not.toMatch(/PDF|白標/i)
  })

  it('uses the approved platform list in conversion and dashboard copy', () => {
    expect(enMessages.upsell.body).toBe(
      'See your Share of Voice across ChatGPT, Google AI, Perplexity, Claude, and Gemini — automatically.',
    )
    expect(zhMessages.upsell.body).toBe(
      '自動監測你在 ChatGPT、Google AI、Perplexity、Claude 及 Gemini 的品牌佔有率。',
    )
    expect(enMessages.dashboard.add_first_brand_body).toBe(
      'Track your Share of Voice across ChatGPT, Google AI, Perplexity, Claude, and Gemini. Each brand gets a full diagnostic dashboard with 20 AI readiness checks and agent analysis.',
    )
    expect(zhMessages.dashboard.add_first_brand_body).toBe(
      '追蹤你在 ChatGPT、Google AI、Perplexity、Claude 及 Gemini 的聲音份額。每個品牌都有完整診斷儀表板，包含 20 項 AI 就緒檢查及代理分析。',
    )
  })

  it('does not substitute GPT-4o in tracked-platform recommendations', () => {
    expect(enMessages.dashboard.step_improve_body).toBe(
      'AI agents analyze your scan and give you specific recommendations. Each platform (ChatGPT, Google AI, Perplexity, Claude, Gemini) evaluates your content differently — we show you what each one needs.',
    )
    expect(enMessages.dashboard.step_improve_locked).toBe(
      'Upgrade to Pro to unlock AI agent analysis. Get platform-specific recommendations from ChatGPT, Google AI, Perplexity, Claude, and Gemini. Track your progress over time with before-and-after metrics.',
    )
    expect(zhMessages.dashboard.step_improve_body).toBe(
      'AI 代理會分析你的掃描結果並提供具體建議。每個平台（ChatGPT、Google AI、Perplexity、Claude、Gemini）對內容的評估各有不同——我們會告訴你每個平台需要甚麼。',
    )
    expect(zhMessages.dashboard.step_improve_locked).toBe(
      '升級至專業版即可解鎖 AI 代理分析。獲取 ChatGPT、Google AI、Perplexity、Claude 及 Gemini 的平台專屬建議，並以前後對比指標追蹤你的進度。',
    )
  })

  it('does not advertise six tracked platforms', () => {
    expect(JSON.stringify(enMessages)).not.toMatch(/6 AI platforms|6 AI Platforms/)
    expect(JSON.stringify(zhMessages)).not.toMatch(/6 個 AI 平台/)
  })

  it('distinguishes the free account from paid subscriptions', () => {
    expect(enMessages.pricing.faq_4_a).not.toMatch(/Starter plan is permanently free/i)
    expect(zhMessages.pricing.faq_4_a).not.toMatch(/入門版永久免費/)
    expect(enMessages.pricing.free_account_body).toMatch(/saved scan/i)
    expect(enMessages.pricing.free_account_body).toMatch(/owned report/i)
    expect(enMessages.pricing.free_account_body).toMatch(/no (credit )?card/i)
    expect(zhMessages.pricing.free_account_body).toContain('儲存掃描')
    expect(zhMessages.pricing.free_account_body).toContain('專屬報告')
    expect(zhMessages.pricing.free_account_body).toContain('無需信用卡')
  })

  it.each([
    ['en', enMessages],
    ['zh-HK', zhMessages],
  ] as const)('keeps Basic and free-account scan allowances consistent in %s', (locale, messages) => {
    const translate = createTranslator({ locale, messages, namespace: 'pricing' })
    const basic = buildPricingAllowanceProjection(
      'basic',
      (key, values) => translate(key as never, values as never),
    )
    const faq = translate('faq_1_a', {
      basicScans: basic.scans,
      proScans: '',
      enterpriseScans: '',
    })

    expect(basic.scans).toContain(String(PLAN_CATALOG.basic.monthlyScanLimit))
    expect(faq).toContain(basic.scans)
    expect(messages.pricing.faq_4_a).toMatch(locale === 'en' ? /first scan/i : /首次掃描/)
  })
  it('uses the core Fix Pack outputs in the public promise', () => {
    const englishCopy = enMessages.home.cta_bottom_body + ' ' + enMessages.pricing.bottom_body
    const chineseCopy = zhMessages.home.cta_bottom_body + ' ' + zhMessages.pricing.bottom_body
    for (const item of PRODUCT_FACTS.fixPack) {
      expect(englishCopy).toContain(item)
      expect(chineseCopy).toContain(item)
    }
  })

  it('keeps the pricing interaction contract accessible', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/[lang]/pricing/page.tsx'), 'utf8')
    expect(source).not.toContain('role="switch"')
    expect(source).not.toMatch(/\bannual\b/i)
    expect(source).toContain('min-h-11')
    expect(source).toContain('transition-colors')
    expect(source).toContain('role="alert"')
    expect(source).toContain('overflow-x-auto')
    expect(source).toContain('table-fixed')
    expect(source).toContain("aria-label={t('comparison_label')}")
    expect(source).not.toContain('scale-[1.02]')
    expect(source).not.toContain("`${t('coming_soon')}: ${t('row_client_report')}`")
    expect(source).not.toContain("t('row_pdf')")
  })


  it('defines the complete client-report browser contract', () => {
    const source = readFileSync(resolve(process.cwd(), 'e2e/client-reports.spec.ts'), 'utf8')

    for (const contract of [
      'eligible scan CTA',
      'ineligible scan CTA',
      'branding save and initials fallback',
      'baseline draft',
      'comparable draft with improvement and regression',
      'AI failure preserves editable deterministic summary',
      'manual edit, preview, first publish, copy, and open',
      'newer draft leaves published version unchanged',
      'publish update changes public content',
      'counters and contact redirect',
      'rotate and revoke invalidate old links',
      'invalid public link is a neutral 404',
      'Free and Basic API denial and upgrade state',
      'keyboard focus, live announcements, and target sizes',
      'no console errors or horizontal overflow',
      'client payload excludes private fields and secrets',
    ]) {
      expect(source).toContain(contract)
    }

    expect(source).toContain("['en', 'zh-HK']")
    expect(source).toContain('width: 375, height: 812')
    expect(source).toContain('width: 1440, height: 900')
    expect(source).toContain('const redirectPromise = publicPage.waitForResponse')
    expect(source).toContain('await contactLink.click()')
    expect(source).not.toContain('const redirect = await context.request.get(new URL(contactHref!')
  })

  it('keeps both E2E roots discoverable by the repository Playwright config', () => {
    const source = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8')
    expect(source).toContain("testDir: '.'")
    expect(source).toContain("'tests/e2e/**/*.spec.ts'")
    expect(source).toContain("'e2e/**/*.spec.ts'")
    // The mobile project must still exclude the ROOT e2e/ directory. This was a
    // literal `testIgnore: 'e2e/**/*.spec.ts'` until the a11y viewport projects
    // landed: project-level testIgnore REPLACES the top-level one rather than
    // merging, so each project now spreads the base array and the bare-string
    // form no longer exists. Assert the intent, not the syntax.
    expect(source).toMatch(/testIgnore: \[[^\]]*'e2e\/\*\*\/\*\.spec\.ts'/)
  })

  it('exposes the pricing comparison as a semantic table', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/[lang]/pricing/page.tsx'), 'utf8')
    expect(source).toContain('<table')
    expect(source).toContain('<thead>')
    expect(source).toContain('<tbody>')
    expect(source).toContain('scope="col"')
    expect(source).toContain('scope="row"')
    expect(source).toContain('<td')
    expect(source).toContain('className="sr-only"')
    expect(enMessages.pricing.included).toBe('Included')
    expect(enMessages.pricing.not_included).toBe('Not included')
    expect(zhMessages.pricing.included).toBe('包括')
    expect(zhMessages.pricing.not_included).toBe('不包括')
  })

})
