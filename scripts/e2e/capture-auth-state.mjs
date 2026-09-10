import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { describeAuthConfig, formatRefusal } from './auth-config.mjs'

/**
 * Captures a signed-in session once, so the authenticated E2E journey can replay it.
 *
 * **This script does not sign anyone in.** It opens a browser at the login page,
 * waits for a human to complete the magic link or the Google flow themselves, and
 * then saves the resulting cookies. That boundary is the point: this product has
 * no password sign-in — only `authClient.signIn.magicLink` and
 * `signIn.social({ provider: 'google' })` — so there are no credentials to
 * automate even in principle, and a tool that entered someone's credentials for
 * them is not something this repo should contain.
 *
 * What it replaces was worse than nothing. `tests/fixtures/auth.ts` used to fill
 * `input[type="password"]`, a field that has never existed in this app, and when
 * the password was empty — always — it handed the caller a plain anonymous page
 * named `authenticatedPage`. A test using it would have run logged out while
 * reading as logged in.
 *
 * Run:  npm run e2e:auth:capture
 * Then: npm run e2e:authenticated
 */

export const STATE_PATH = process.env.PLAYWRIGHT_STORAGE_STATE?.trim() || '.auth/owner-state.json'
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const LANG = process.env.PLAYWRIGHT_AUTH_LANG?.trim() || 'en'
/** Generous: a human has to find the email, open it, and come back. */
const WINDOW_MS = Number(process.env.PLAYWRIGHT_AUTH_TIMEOUT_MS ?? 10 * 60 * 1000)

function requireConfigured() {
  // Fail before opening a browser. Without a usable auth configuration the app
  // cannot establish a session at all, so anything captured would be an
  // anonymous state file wearing an authenticated name — the exact failure this
  // path exists to stop.
  //
  // `stateExists: true` because an absent session is what this script is FOR;
  // only the configuration can block it here. Shape is checked, not merely
  // presence: a Postgres DSN pasted into this variable parses as a URL and would
  // otherwise sail through to a browser, a silent sign-in failure, and a
  // ten-minute timeout naming nothing.
  const { blockers } = describeAuthConfig({
    baseUrl: process.env.NEON_AUTH_BASE_URL,
    stateExists: true,
  })
  if (!process.env.NEON_AUTH_COOKIE_SECRET?.trim()) {
    blockers.push('NEON_AUTH_COOKIE_SECRET is not set in .env.local (it must be at least 32 chars).')
  }
  if (blockers.length === 0) return

  throw new Error(formatRefusal(blockers).trimStart())
}

async function main() {
  requireConfigured()

  const target = resolve(process.cwd(), STATE_PATH)
  mkdirSync(dirname(target), { recursive: true })

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(`${BASE_URL}/${LANG}/auth/login`, { waitUntil: 'domcontentloaded' })

    process.stdout.write([
      '',
      'A browser window is open at the sign-in page.',
      '',
      '  1. Sign in yourself — magic link or Google. Nothing here types for you.',
      '  2. Wait until the dashboard has loaded.',
      '',
      `Waiting up to ${Math.round(WINDOW_MS / 60000)} minutes...`,
      '',
    ].join('\n'))

    // The dashboard sits behind requireAuth, so reaching it IS the proof that a
    // session exists. Waiting on the URL rather than a cookie name keeps this
    // working if the cookie is ever renamed.
    await page.waitForURL(/\/(en|zh-HK)\/dashboard/, { timeout: WINDOW_MS })

    const state = await context.storageState({ path: target })
    if (state.cookies.length === 0) {
      throw new Error('Reached the dashboard but captured no cookies — refusing to write an empty session.')
    }

    process.stdout.write(`\nSaved ${state.cookies.length} cookies to ${STATE_PATH}\n`)
    process.stdout.write('That file is gitignored. It is a live session — treat it like a password.\n')
    process.stdout.write('Now run: npm run e2e:authenticated\n\n')
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n\n`)
  process.exitCode = 1
})
