import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openOnboardingComponent } from '../fixtures/onboarding-browser'

for (const lang of ['en', 'zh-HK']) {
  test(`AI draft is editable, requires confirmation, and keeps chosen context (${lang})`, async ({ page }) => {
    await openOnboardingComponent(page, lang)
    const requests: Record<string, unknown>[] = [], completions: Record<string, unknown>[] = []
    await page.route('**/api/onboarding/assist', route => {
      const body = route.request().postDataJSON(); requests.push(body)
      return route.fulfill({ json: { brandName: 'Suggested brand', domain: 'example.test', description: 'Synthetic design workshops.', industry: 'education', language: body.language, market: body.market, sourceUrl: 'https://example.test/', fetchedAt: '2026-10-11T00:00:00Z' } })
    })
    await page.route('**/api/onboarding/complete', route => {
      const body = route.request().postDataJSON(); completions.push(body)
      return route.fulfill({ json: { clientId: '11111111-1111-4111-8111-111111111111', progress: { prompts: 'ready' } } })
    })
    await page.locator('#brand-assist-url').fill('example.test')
    const generate = page.getByRole('button', { name: lang === 'en' ? 'Draft my brand profile' : '草擬我的品牌資料' })
    await expect(generate).toBeDisabled()
    await page.locator('#brand-assist-language').selectOption(lang === 'en' ? 'zh-HK' : 'en')
    await page.locator('#brand-assist-market').selectOption('TW')
    await generate.click()
    await expect(page.locator('#brand-draft-name')).toHaveValue('Suggested brand')
    expect(completions).toHaveLength(0)
    await page.locator('#brand-draft-name').fill('Reviewed brand')
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(axe.violations).toEqual([])
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.evaluate(() => document.documentElement.clientWidth))
    await page.getByRole('button', { name: lang === 'en' ? 'Use these details' : '使用這些資料' }).click()
    expect(completions).toHaveLength(0)
    await page.reload()
    await expect(page.locator('#onboarding-description')).toHaveValue('Synthetic design workshops.')
    await page.getByRole('button', { name: lang === 'en' ? 'Go to my dashboard' : '前往我的儀表板', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-navigation', /dashboard\/11111111/)
    expect(requests).toHaveLength(1)
    expect(completions).toHaveLength(1)
    expect(completions[0]).toMatchObject({ brandName: 'Reviewed brand', domain: 'example.test', market: 'TW', language: lang === 'en' ? 'zh-HK' : 'en' })
  })
  test(`AI network failure releases the control and keeps manual setup available (${lang})`, async ({ page }) => {
    await openOnboardingComponent(page, lang)
    await page.route('**/api/onboarding/assist', route => route.abort('failed'))
    await page.locator('#brand-assist-url').fill('example.test')
    await page.locator('#brand-assist-language').selectOption('en')
    await page.locator('#brand-assist-market').selectOption('HK')
    const generate = page.getByRole('button', { name: lang === 'en' ? 'Draft my brand profile' : '草擬我的品牌資料' })
    await generate.click(); await expect(page.getByRole('alert')).toBeVisible(); await expect(generate).toBeEnabled()
    await expect(page.locator('#brand-assist-url')).toHaveValue('example.test')
    await page.getByRole('button', { name: lang === 'en' ? 'Continue' : '繼續', exact: true }).click()
    await expect(page.locator('#onboarding-domain')).toBeVisible()
  })
}
