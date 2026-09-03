import { defineConfig, devices } from '@playwright/test'

const isCi = Boolean(process.env.CI)
const baseURL = isCi ? 'http://127.0.0.1:3000' : (process.env.BASE_URL || 'http://localhost:3000')
const releaseScanConfigured = Boolean(process.env.BASE_URL && process.env.LIVE_SCAN_TARGET)
const clientReportFixtureConfigured = Boolean(process.env.PLAYWRIGHT_CLIENT_REPORT_FIXTURE)
const testIgnore = [
  '**/.worktrees/**',
  '**/.playwright-ci-server/**',
  ...(releaseScanConfigured ? [] : ['tests/e2e/live-scan-smoke.spec.ts']),
  ...(clientReportFixtureConfigured ? [] : ['e2e/client-reports.spec.ts']),
]

export default defineConfig({
  testDir: '.',
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
  ],
  ...(process.env.START_DEV_SERVER || isCi ? { webServer: { command: isCi ? 'node scripts/start-playwright-ci-server.cjs' : 'npm run dev', url: 'http://127.0.0.1:3000', reuseExistingServer: false, timeout: 120_000 } } : {}),
})
