import { defineConfig, devices } from '@playwright/test'

const isCi = Boolean(process.env.CI)
const baseURL = isCi ? 'http://127.0.0.1:3000' : (process.env.BASE_URL || 'http://localhost:3000')

export default defineConfig({
  testDir: './tests/e2e', globalSetup: './tests/globalSetup.ts', globalTeardown: './tests/globalTeardown.ts', fullyParallel: true,
  forbidOnly: isCi, retries: 0, workers: isCi ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['json', { outputFile: 'playwright-results.json' }], ['list']],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure', actionTimeout: 10_000, navigationTimeout: 30_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 5'] } }],
  ...(process.env.START_DEV_SERVER || isCi ? { webServer: { command: 'npm run dev', url: 'http://127.0.0.1:3000', reuseExistingServer: false, timeout: 120_000 } } : {}),
})
