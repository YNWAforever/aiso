import { TEST_SCAN_ID } from '../constants.js'
import { expect, test } from '@playwright/test'
import { ResultPage } from './pages/ResultPage.js'

const LANG = 'en'
const hasSeededResult = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

test.describe('Account unlock on a seeded public result', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasSeededResult, 'Requires Supabase URL, anon key, and service-role key for the seeded result fixture.')
    await page.goto('/' + LANG + '/result/' + TEST_SCAN_ID, { waitUntil: 'networkidle' })
  })

  test('shows one account unlock without the private breakdown', async ({ page }) => {
    const result = new ResultPage(page, LANG)
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
    await page.route('**/sign-in/magic-link*', route => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    const result = new ResultPage(page, LANG)
    await result.submitEmail('unlock@example.com')
    await expect.poll(() => requestBody).not.toBeNull()
    const body: Record<string, unknown> = requestBody ?? {}
    const callback = new URL(String(body.callbackURL ?? body.callbackUrl ?? ''))
    expect(callback.pathname).toBe('/' + LANG + '/auth/complete')
    expect(callback.searchParams.get('next')).toBe('/' + LANG + '/result/' + TEST_SCAN_ID + '?claim=1')
  })

  test('invalid email format prevents submission', async ({ page }) => {
    const result = new ResultPage(page, LANG)
    await result.emailInput.fill('not-an-email')
    await result.createAccountButton.click()
    expect(await result.emailInput.evaluate((element: HTMLInputElement) => !element.checkValidity())).toBe(true)
  })
})

test('unknown scan ID returns not-found', async ({ page }) => {
  const response = await page.goto('/' + LANG + '/result/00000000-dead-beef-0000-000000000000', {
    waitUntil: 'networkidle',
  })
  expect(response?.status()).toBe(404)
})
