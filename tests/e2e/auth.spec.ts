/**
 * E2E: Authentication flows
 *
 * The app uses magic-link + Google OAuth (no password field).
 * Login page: email input → "Send Magic Link" button + "Continue with Google"
 *
 * Covers:
 *   - Login page renders with email field and magic-link button
 *   - Google OAuth button is present
 *   - Empty form submission shows validation
 *   - Dashboard redirects unauthenticated users to login
 *   - Locale routing for /auth/login
 */
import { test, expect } from '@playwright/test'

const LANG = 'en'
const hasNeonAuth = Boolean(process.env.NEON_AUTH_BASE_URL)

test.describe('Auth — login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/${LANG}/auth/login`)
    await page.waitForLoadState('networkidle')
  })

  test('login page renders email input', async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await page.screenshot({ path: 'playwright-report/login-page.png' })
  })

  test('login page renders magic-link submit button', async ({ page }) => {
    // The form has a submit button (Send Magic Link / Sign in / etc.)
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('login page shows Google OAuth option', async ({ page }) => {
    // Google button is always present alongside magic link
    await expect(
      page.locator('button:has-text("Google"), a:has-text("Google")').first()
    ).toBeVisible()
  })

  test('login page has correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/login|sign in|AISO|AEO|Fimmick/i)
  })

  test('submitting empty email shows HTML5 validation', async ({ page }) => {
    await page.locator('button[type="submit"]').click()
    // HTML5 required validation: the email field should be invalid, page stays on login
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible()
    // Check validity via JS — required + empty = invalid
    const isInvalid = await emailInput.evaluate(
      (el: HTMLInputElement) => !el.checkValidity()
    )
    expect(isInvalid).toBe(true)
  })

  const magicLinkCases = [
    { lang: 'en', checkEmail: 'Check your email' },
    { lang: 'zh-HK', checkEmail: '請查看你的電郵' },
  ] as const

  for (const copy of magicLinkCases) {
    test(`submitting a valid email requests Neon magic link and confirms success in ${copy.lang}`, async ({ page }) => {
      await page.goto(`/${copy.lang}/auth/login`)

      let routeInvocations = 0
      await page.route('**/sign-in/magic-link*', async route => {
        routeInvocations += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        })
      })

      const requestPromise = page.waitForRequest(request =>
        request.method() === 'POST'
        && new URL(request.url()).pathname.endsWith('/sign-in/magic-link')
      )

      await page.locator('input[type="email"]').fill('test@example.com')
      await page.locator('button[type="submit"]').click()

      const request = await requestPromise
      expect(request.method()).toBe('POST')
      expect(routeInvocations).toBe(1)
      await expect(page.getByText(copy.checkEmail, { exact: true })).toBeVisible({ timeout: 8_000 })
    })
  }

  const magicLinkErrorCases = [
    {
      lang: 'en',
      error: 'Could not send the magic link. Please try again.',
    },
    {
      lang: 'zh-HK',
      error: '無法發送登入連結，請再試一次。',
    },
  ] as const

  for (const copy of magicLinkErrorCases) {
    test(`provider error recovery renders localized generic copy in ${copy.lang}`, async ({ page }) => {
      const providerSecret = 'provider-token-and-message-must-not-render'
      await page.goto(`/${copy.lang}/auth/login`)
      await page.route('**/sign-in/magic-link*', async route => {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'PROVIDER_UNAVAILABLE',
            message: providerSecret,
          }),
        })
      })

      await page.locator('input[type="email"]').fill('test@example.com')
      await page.locator('button[type="submit"]').click()

      await expect(page.getByText(copy.error, { exact: true })).toBeVisible({ timeout: 8_000 })
      await expect(page.locator('button[type="submit"]')).toBeEnabled()
      await expect(page.getByText(providerSecret, { exact: true })).not.toBeVisible()
    })
  }

})

test.describe('Auth — access control', () => {
  test('dashboard redirects unauthenticated users to login', async ({ page }) => {
    test.skip(!hasNeonAuth, 'Requires NEON_AUTH_BASE_URL to evaluate the real unauthenticated session boundary.')
    await page.goto(`/${LANG}/dashboard`)
    await page.waitForLoadState('networkidle')
    const url = page.url()
    const isLoginPage = url.includes('/auth/login') || url.includes('/login')
    const hasLoginForm = await page.locator('input[type="email"]').isVisible()
    expect(isLoginPage || hasLoginForm).toBe(true)
  })
})

test.describe('Auth — locale routing', () => {
  test('bare /auth/login redirects to localised route', async ({ page }) => {
    await page.goto('/auth/login', { waitUntil: 'networkidle' })
    const url = page.url()
    expect(url).toMatch(/\/(en|zh-HK|zh-TW)\/auth\/login/)
  })
})
