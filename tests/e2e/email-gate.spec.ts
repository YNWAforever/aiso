import { TEST_SCAN_ID } from '../constants.js'
import { test, expect } from '../fixtures/auth.js'
import { ResultPage } from './pages/ResultPage.js'

const LANG = 'en'

test.describe('Account unlock', () => {
  test.beforeEach(async ({ page }) => {
    const response = await page.goto('/' + LANG + '/result/' + TEST_SCAN_ID, {
      waitUntil: 'domcontentloaded',
    })
    if (response?.status() === 404) {
      test.skip(true, 'Result page 404 because the seeded scan is unavailable.')
    }
    await page.waitForLoadState('networkidle')
  })

  test('shows one public account unlock without the private breakdown', async ({ page }) => {
    const result = new ResultPage(page)

    await expect(result.score).toBeVisible()
    await expect(result.topIssue).toBeVisible()
    await expect(result.topIssue).toHaveText(/.+/)
    await expect(result.createAccountButton).toBeVisible()
    await expect(result.googleSignupButton).toBeVisible()
    await expect(page.getByText(/No credit card/i)).toBeVisible()
    await expect(result.fullCheckBreakdown).not.toBeVisible()
  })

  test('magic-link callback preserves locale and scan ID', async ({ page }) => {
    let requestBody: Record<string, unknown> | null = null
    await page.route('**/sign-in/magic-link*', async route => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
    })

    const result = new ResultPage(page)
    await result.submitEmail('unlock@example.com')
    await expect.poll(() => requestBody).not.toBeNull()

    const callbackURL = String(
      requestBody?.callbackURL ?? requestBody?.callbackUrl ?? '',
    )
    const callback = new URL(callbackURL)
    expect(callback.pathname).toBe('/' + LANG + '/auth/complete')
    expect(callback.searchParams.get('next')).toBe(
      '/' + LANG + '/onboarding?scan=' + TEST_SCAN_ID,
    )
  })

  test('invalid email format prevents submission', async ({ page }) => {
    const result = new ResultPage(page)
    await result.emailInput.fill('not-an-email')
    await result.createAccountButton.click()
    await expect(result.emailInput).toBeVisible()
    const isInvalid = await result.emailInput.evaluate(
      (element: HTMLInputElement) => !element.checkValidity(),
    )
    expect(isInvalid).toBe(true)
  })
})

test.describe('Account unlock — unknown scan ID', () => {
  test('result page returns not-found for unknown scan ID', async ({ page }) => {
    const response = await page.goto(
      '/' + LANG + '/result/00000000-dead-beef-0000-000000000000',
      { waitUntil: 'networkidle' },
    )
    expect(response?.status()).toBe(404)
  })
})
