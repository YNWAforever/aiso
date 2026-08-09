import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { sanitizeAxeResults } from '@/lib/axe-report'
import { TEST_SCAN_ID } from '../constants.js'

async function expectNoBlockingA11y(page: Page, testInfo: TestInfo, flow: string) {
  const results = await new AxeBuilder({ page }).analyze()
  const report = sanitizeAxeResults(results)
  await testInfo.attach(`axe-report-${flow}`, {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  })
  const blocking = results.violations.filter(
    violation => violation.impact === 'critical' || violation.impact === 'serious',
  )

  expect(
    blocking,
    JSON.stringify(blocking.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodeCount: nodes.length,
    }))),
  ).toEqual([])
}

async function waitForResultAnimation(page: Page) {
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="score-reveal"]')
    return element instanceof HTMLElement && getComputedStyle(element).opacity === '1'
  })
}

async function expectReachableByTab(page: Page, target: Locator) {
  await page.locator('body').focus()

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.keyboard.press('Tab')
    if (await target.evaluate(element => document.activeElement === element)) {
      await expect(target).toHaveAccessibleName(/.+/)
      return
    }
  }

  throw new Error('Expected control to be reachable by keyboard tabbing')
}

test('English home page has no blocking accessibility violations and keyboard-reachable scan controls', async ({ page }, testInfo) => {
  await page.goto('/en', { waitUntil: 'networkidle' })

  const scanInput = page.locator('#home-scan-url')
  const scanButton = page.locator('form').first().getByRole('button')
  await expectReachableByTab(page, scanInput)
  await expectReachableByTab(page, scanButton)
  await expectNoBlockingA11y(page, testInfo, 'home')
})

test('English login page has no blocking accessibility violations and keyboard-reachable primary controls', async ({ page }, testInfo) => {
  await page.goto('/en/auth/login', { waitUntil: 'networkidle' })

  const googleButton = page.getByRole('button', { name: /continue with google/i })
  const emailInput = page.locator('#login-email')
  const magicLinkButton = page.getByRole('button', { name: /send magic link/i })
  await expectReachableByTab(page, googleButton)
  await expectReachableByTab(page, emailInput)
  await expectReachableByTab(page, magicLinkButton)
  await expectNoBlockingA11y(page, testInfo, 'login')
})

test('fixture result page has no blocking accessibility violations before and after email unlock', async ({ page }, testInfo) => {
  await page.route('**/api/scan/lead', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true }),
  }))
  await page.goto(`/en/result/${TEST_SCAN_ID}`, { waitUntil: 'networkidle' })

  await waitForResultAnimation(page)
  await expectNoBlockingA11y(page, testInfo, 'result-before-unlock')

  await page.locator('#result-email').fill('accessibility@example.com')
  await page.getByRole('button', { name: /unlock report/i }).click()
  await expect(page.locator('#result-email')).not.toBeVisible()
  await waitForResultAnimation(page)
  await expectNoBlockingA11y(page, testInfo, 'result-after-unlock')
})
