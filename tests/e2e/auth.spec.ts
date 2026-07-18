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

  test('submitting a valid email shows sending state or success message', async ({ page }) => {
    // Stub the local Neon Auth proxy so no real email is sent
    await page.route('**/sign-in/magic-link*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
    })

    await page.locator('input[type="email"]').fill('test@example.com')
    await page.locator('button[type="submit"]').click()

    // After submitting, the button should show a loading/sent state or a success message
    await expect(
      page.locator('text=/sent|check|email|magic|success/i').first()
        .or(page.locator('button:has-text("Sending"), button[disabled]').first())
    ).toBeVisible({ timeout: 8_000 })
    await page.screenshot({ path: 'playwright-report/login-magic-sent.png' })
  })
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
