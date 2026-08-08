import { defineConfig, devices } from '@playwright/test'
import fs from 'fs'
import path from 'path'

// Load .env.local so Supabase keys are available in test process
const envPath = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim()
    if (k && !process.env[k]) process.env[k] = v
  }
}

/**
 * Fimmick AEOGEO — Playwright E2E configuration
 *
 * Runs against the local dev server by default.
 * Set BASE_URL env var to target staging / production.
 */
export default defineConfig({
  testDir: '.',
  testMatch: [
    'tests/e2e/**/*.spec.ts',
    'e2e/**/*.spec.ts',
  ],
  globalSetup: './tests/globalSetup.ts',
  globalTeardown: './tests/globalTeardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-results.json' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testIgnore: 'e2e/**/*.spec.ts',
      use: { ...devices['Pixel 5'] },
    },
  ],
  // If a dev server is already running, skip auto-start.
  // Set START_DEV_SERVER=1 to have Playwright start it automatically (e.g. in CI).
  ...(process.env.START_DEV_SERVER
    ? {
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),
})
