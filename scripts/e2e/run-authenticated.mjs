import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

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

const STATE_PATH = process.env.PLAYWRIGHT_STORAGE_STATE?.trim() || '.auth/owner-state.json'

const blockers = []
if (!process.env.NEON_AUTH_BASE_URL?.trim()) {
  blockers.push([
    'NEON_AUTH_BASE_URL is not set in .env.local.',
    '     Without it getProfile() cannot resolve a session and every authenticated',
    '     route answers 503, so even a captured session would prove nothing.',
  ].join('\n'))
}
if (!existsSync(resolve(process.cwd(), STATE_PATH))) {
  blockers.push([
    `No captured session at ${STATE_PATH}.`,
    '     Run: npm run e2e:auth:capture',
    '     It opens a browser and waits for YOU to sign in — magic link or Google.',
    '     It types nothing on your behalf; this product has no password sign-in.',
  ].join('\n'))
}

if (blockers.length > 0) {
  process.stderr.write([
    '',
    'The authenticated owner journey (AC-14) cannot run yet.',
    '',
    ...blockers.map((blocker, index) => `  ${index + 1}. ${blocker}`),
    '',
    'This is the one gate in the suite a machine cannot satisfy on its own.',
    '',
  ].join('\n'))
  process.exit(1)
}

const child = spawnSync(
  process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test', '--project=authenticated-mobile', ...process.argv.slice(2)],
  { stdio: 'inherit' },
)
process.exit(child.status ?? 1)
