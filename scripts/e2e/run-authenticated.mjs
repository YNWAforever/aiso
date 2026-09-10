import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_STATE_PATH, describeAuthConfig, formatRefusal } from './auth-config.mjs'

/**
 * Runs the authenticated owner journey, or explains precisely why it cannot.
 *
 * Without this, an unconfigured run ends at Playwright's own
 * `Project(s) "authenticated-mobile" not found`. That is a genuine failure — it
 * exits non-zero, so nothing is silently skipped — but it reads as a broken
 * config rather than a missing session, and it names none of the things a human
 * has to do. Someone meeting it cold would go looking for a typo in
 * playwright.config.ts.
 *
 * The distinction this preserves is the one AC-14 turns on: "we have not run the
 * authenticated journey" must never be mistakable for "we ran it and it passed".
 * So this refuses loudly and actionably, and never exits 0 having done nothing.
 */

const STATE_PATH = process.env.PLAYWRIGHT_STORAGE_STATE?.trim() || DEFAULT_STATE_PATH

const { blockers } = describeAuthConfig({
  baseUrl: process.env.NEON_AUTH_BASE_URL,
  statePath: STATE_PATH,
  stateExists: existsSync(resolve(process.cwd(), STATE_PATH)),
})

if (blockers.length > 0) {
  process.stderr.write(formatRefusal(blockers))
  process.exit(1)
}

const child = spawnSync(
  process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test', '--project=authenticated-mobile', ...process.argv.slice(2)],
  { stdio: 'inherit' },
)
process.exit(child.status ?? 1)
