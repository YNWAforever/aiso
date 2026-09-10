import { test as base } from '@playwright/test'

/**
 * Authenticated-page fixture. It REFUSES rather than pretending.
 *
 * What was here before was a trap. It read PLAYWRIGHT_TEST_EMAIL and
 * PLAYWRIGHT_TEST_PASSWORD, and:
 *
 *  - filled `input[type="password"]` on `/en/auth/login` — a field that does not
 *    exist and never has. Sign-in is `authClient.signIn.magicLink` or
 *    `signIn.social({ provider: 'google' })` (components/auth/LoginForm.tsx).
 *    There is no password anywhere in this product to give it;
 *  - and when the password was empty, which it always is, it silently handed the
 *    caller a plain anonymous page under the name `authenticatedPage`. A test
 *    using it would have run logged out while reading as logged in.
 *
 * Nothing imported it, so nothing was actually broken — but it is why CLAUDE.md
 * still lists PLAYWRIGHT_TEST_PASSWORD as an E2E variable, and why an
 * authenticated journey looked one environment variable away when it is not.
 *
 * The real path, for a magic-link/OAuth product, is Playwright's `storageState`:
 * a human signs in once, the resulting session is saved to a gitignored file, and
 * the suite reuses it. That needs the four secrets in `.env.local` populated
 * first — today `NEON_AUTH_COOKIE_SECRET`, `NEON_AUTH_BASE_URL`,
 * `REPORT_SHARE_SECRET` and `PUBLIC_SCAN_RATE_LIMIT_SECRET` are all empty, so
 * `getProfile()` throws and every authenticated route answers 503.
 *
 * Until that exists this fixture throws, because a fixture that yields an
 * anonymous page is worse than no fixture: it turns "we never tested this" into
 * "we tested it and it passed".
 */

const REASON = [
  'authenticatedPage is not available.',
  '',
  'This product has no password sign-in — only magic link and Google OAuth — so',
  'PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD cannot drive a login, whatever',
  'CLAUDE.md still says. Use Playwright storageState instead:',
  '',
  '  1. Populate NEON_AUTH_COOKIE_SECRET, NEON_AUTH_BASE_URL, REPORT_SHARE_SECRET',
  '     and PUBLIC_SCAN_RATE_LIMIT_SECRET in .env.local. All four are empty today,',
  '     so getProfile() throws and every authenticated route answers 503.',
  '  2. Sign in once by hand and save the session with',
  '     `await context.storageState({ path: ... })` into a gitignored file.',
  '  3. Point a Playwright project at it via `use: { storageState }`, and have this',
  '     fixture consume that context.',
].join('\n')

export const test = base.extend<{ authenticatedPage: never }>({
  // second param renamed from playwright's conventional `use` so eslint's
  // react-hooks/rules-of-hooks does not mistake the call for the React `use` hook
  async authenticatedPage(_fixtures, _provide) {
    throw new Error(REASON)
  },
})

export { expect } from '@playwright/test'
