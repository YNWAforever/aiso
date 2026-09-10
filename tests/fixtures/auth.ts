import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { test as base, expect, type Page } from '@playwright/test'

/**
 * An authenticated page, or a loud refusal. Never an anonymous page.
 *
 * The original version of this file was a trap. It read PLAYWRIGHT_TEST_EMAIL and
 * PLAYWRIGHT_TEST_PASSWORD, filled `input[type="password"]` on `/en/auth/login` —
 * a field that has never existed here, because sign-in is
 * `authClient.signIn.magicLink` or `signIn.social({ provider: 'google' })` — and
 * when the password was empty, which it always was, silently handed the caller a
 * plain anonymous page named `authenticatedPage`. A test using it would have run
 * logged out while reading as logged in.
 *
 * It then threw unconditionally, which was correct but terminal. Now it consumes
 * the session a human captured once with `npm run e2e:auth:capture`, and throws
 * only when there is none — naming the command that fixes it.
 *
 * The refusal matters as much as the fixture. A skip here would make "we never
 * tested the authenticated journey" indistinguishable from "we tested it and it
 * passed", which is the whole reason AC-14 stayed BLOCKED rather than quietly
 * green.
 */

const STATE_PATH = process.env.PLAYWRIGHT_STORAGE_STATE?.trim() || '.auth/owner-state.json'

const REASON = [
  `authenticatedPage needs a captured session, and ${STATE_PATH} does not exist.`,
  '',
  'This product has no password sign-in — only magic link and Google OAuth — so no',
  'credential can be supplied to a runner. Capture one once, by hand:',
  '',
  '  1. Put NEON_AUTH_BASE_URL in .env.local (it is empty today, so getProfile()',
  '     cannot resolve a session and every authenticated route answers 503).',
  '  2. npm run e2e:auth:capture   — signs YOU in; it types nothing for you.',
  '  3. npm run e2e:authenticated',
].join('\n')

export const test = base.extend<{ authenticatedPage: Page }>({
  // Second parameter renamed from Playwright's conventional `use` so eslint's
  // react-hooks/rules-of-hooks does not mistake the call for the React `use` hook.
  async authenticatedPage({ page }, provide) {
    if (!existsSync(resolve(process.cwd(), STATE_PATH))) throw new Error(REASON)

    // The storage state is applied by the project's `use.storageState`, so the
    // page arrives already carrying the session. Proving that here, once, stops a
    // stale or expired capture from being reported as a product failure in every
    // spec that follows.
    await page.goto('/en/dashboard')
    await expect(page).toHaveURL(/\/en\/dashboard/, { timeout: 15_000 })

    await provide(page)
  },
})

export { expect } from '@playwright/test'
