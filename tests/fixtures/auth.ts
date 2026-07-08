import { test as base } from '@playwright/test'

/**
 * Extended test fixture with helpers for authenticated state.
 *
 * Usage:
 *   import { test } from '../../fixtures/auth'
 *   test('dashboard loads', async ({ authenticatedPage }) => { ... })
 */

type AuthFixtures = {
  /** Page with a logged-in session cookie pre-injected. */
  authenticatedPage: ReturnType<typeof base.extend>
}

// Extend base test with an authenticatedPage fixture.
// In CI, credentials come from PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD env vars.
export const test = base.extend<AuthFixtures>({
  // second param renamed from playwright's conventional `use` so eslint's
  // react-hooks/rules-of-hooks does not mistake the call for the React `use` hook
  async authenticatedPage({ page }, provide) {
    const email    = process.env.PLAYWRIGHT_TEST_EMAIL    ?? 'test@fimmick.com'
    const password = process.env.PLAYWRIGHT_TEST_PASSWORD ?? ''

    if (password) {
      // Full login flow
      await page.goto('/en/auth/login')
      await page.locator('input[type="email"]').fill(email)
      await page.locator('input[type="password"]').fill(password)
      await page.locator('button[type="submit"]').click()
      await page.waitForURL(/\/dashboard/, { timeout: 15_000 })
    }

    await provide(page as never)
  },
})

export { expect } from '@playwright/test'
