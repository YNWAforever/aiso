import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const isCi = Boolean(process.env.CI)
const baseURL = isCi ? 'http://127.0.0.1:3000' : (process.env.BASE_URL || 'http://localhost:3000')
const releaseScanConfigured = Boolean(process.env.BASE_URL && process.env.LIVE_SCAN_TARGET)
const clientReportFixtureConfigured = Boolean(process.env.PLAYWRIGHT_CLIENT_REPORT_FIXTURE)

/**
 * The authenticated owner journey, which cannot be automated end to end.
 *
 * This product has no password sign-in — only magic link and Google OAuth — so
 * there is no credential a runner could present. A session must be captured once
 * by a human (`npm run e2e:auth:capture`) and replayed from a gitignored file.
 * That makes this a manual gate rather than a CI one, and it is recorded as
 * manual rather than dressed up as automated.
 *
 * Gated on the file EXISTING, not merely on the variable being set: a path
 * pointing at nothing makes Playwright fail with a file error naming no test,
 * which reads as a broken suite rather than an unconfigured one.
 */
const authStatePath = process.env.PLAYWRIGHT_STORAGE_STATE?.trim() || '.auth/owner-state.json'
const authenticatedConfigured = existsSync(resolve(process.cwd(), authStatePath))

/**
 * Worktrees nested inside THIS root, ignored by absolute path.
 *
 * Worktrees moved from `.worktrees/` to `.claude/worktrees/` and testIgnore did
 * not follow, so running from a checkout that contains one made `testDir: '.'`
 * walk in, collect that worktree's copy of every spec, and load a second
 * @playwright/test from its node_modules — the run then died on "Requiring
 * @playwright/test second time" before any test executed.
 *
 * It must be absolute. testIgnore globs are matched against the ABSOLUTE path,
 * so a bare `'**​/.claude/worktrees/**'` also matches every spec of a checkout that
 * IS a worktree — which is most of them here — and silently ignores the entire
 * suite. That is the same absolute-path trap that once left the `mobile` project
 * discovering nothing; `__tests__/config/playwright-projects.test.ts` catches
 * both directions.
 *
 * `respectGitIgnore` is not a backstop: .gitignore names only the old
 * `.worktrees/`, and `.claude/worktrees/` is ignored per-clone through
 * .git/info/exclude, which is never committed.
 */
const nestedWorktrees = join(process.cwd(), '.claude', 'worktrees', '**').replaceAll('\\', '/')

const testIgnore = [
  '**/.worktrees/**',
  nestedWorktrees,
  '**/.playwright-ci-server/**',
  ...(releaseScanConfigured ? [] : ['tests/e2e/live-scan-smoke.spec.ts']),
  ...(clientReportFixtureConfigured ? [] : ['e2e/client-reports.spec.ts']),
  // Excluded from every project below, configured or not. They carry no session,
  // so an authenticated spec would fail under them for want of a cookie — and a
  // failure like that teaches nothing about the page it names.
  'tests/e2e/authenticated/**',
]

export default defineConfig({
  testDir: '.',
  // Skip ignored build/fixture trees during traversal, not only after collecting files.
  respectGitIgnore: true,
  testMatch: ['tests/e2e/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  testIgnore,
  globalSetup: './tests/globalSetup.ts', globalTeardown: './tests/globalTeardown.ts', fullyParallel: true,
  forbidOnly: isCi, retries: 0, workers: isCi ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['json', { outputFile: 'playwright-results.json' }], ['list']],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure', actionTimeout: 10_000, navigationTimeout: 30_000 },
  projects: [
    // Project-level testIgnore REPLACES the top-level testIgnore rather than
    // merging with it, so each project must re-spread the base `testIgnore`
    // array (worktrees, the CI server dir, and the BASE_URL/fixture gates)
    // alongside its own additions -- omitting it would silently re-enable
    // live-scan-smoke.spec.ts and e2e/client-reports.spec.ts whenever their
    // env gates are unset.
    { name: 'chromium', testIgnore: [...testIgnore, 'tests/e2e/a11y/**'], use: { ...devices['Desktop Chrome'] } },
    // `testIgnore` globs are matched against the ABSOLUTE path, so the previous
    // entry for the repository-root e2e/ directory also matched the tail of
    // '.../tests/e2e/scan-flow.spec.ts' and excluded everything. This project
    // discovered ZERO tests from the day it was added. An allow-list cannot
    // fail that way, and matches how the a11y projects below are written.
    { name: 'mobile', testMatch: 'tests/e2e/**/*.spec.ts', testIgnore: [...testIgnore, 'tests/e2e/a11y/**'], use: { ...devices['Pixel 5'] } },
    // The a11y matrix runs at the four widths the base plan's responsive
    // acceptance names, and ONLY there. Without the testIgnore entries above,
    // every a11y test would also run under chromium and mobile -- six passes
    // over each page instead of four.
    ...[375, 768, 1024, 1440].map(width => ({
      name: `a11y-${width}`,
      testMatch: 'tests/e2e/a11y/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width, height: 900 } },
    })),
    // Appended only when a captured session exists. Absent it, the project list
    // is exactly the six above — so `playwright-projects.test.ts`, which fails
    // any configured project that resolves to zero tests, sees nothing new, and
    // CI does not go red for want of something CI structurally cannot have.
    //
    // Pixel 5 because AC-14 is specifically about reviewing and approving on a
    // phone. Its own `testMatch` re-includes the directory the base `testIgnore`
    // removes from everything else.
    ...(authenticatedConfigured
      ? [{
          name: 'authenticated-mobile',
          testMatch: 'tests/e2e/authenticated/**/*.spec.ts',
          testIgnore: ['**/.worktrees/**', nestedWorktrees, '**/.playwright-ci-server/**'],
          use: { ...devices['Pixel 5'], storageState: authStatePath },
        }]
      : []),
  ],
  ...(process.env.START_DEV_SERVER || isCi ? { webServer: { command: isCi ? 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1' : 'npm run dev', url: 'http://127.0.0.1:3000', reuseExistingServer: false, timeout: 120_000 } } : {}),
})
