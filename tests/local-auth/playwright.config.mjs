import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { evidenceMode } from '../../scripts/ci/local-auth-safety.mjs'

const config = JSON.parse(readFileSync(process.env.AISO_LOCAL_AUTH_CONFIG, 'utf8'))
if (config.mode !== evidenceMode || config.containerVerified !== true) throw new Error('LOCAL_AUTH_BROWSER_TARGET_REQUIRED')
const scenario = config.scenario ?? 'first-value'
if (!['first-value', 'brand-isolation'].includes(scenario)) throw new Error('LOCAL_AUTH_SCENARIO_INVALID')
export default defineConfig({
  testDir: '.', testMatch: scenario === 'brand-isolation' ? '**/brand-isolation.spec.mjs' : '**/first-value.spec.mjs',
  fullyParallel: false, workers: 1, retries: 0, maxFailures: 1,
  timeout: 180000, expect: { timeout: 15000 }, outputDir: join(config.output, 'browser-work'),
  reporter: [['./reporter.mjs']],
  use: {
    baseURL: config.appOrigin, ignoreHTTPSErrors: true, trace: 'off', video: 'off', screenshot: 'off',
    actionTimeout: 15000, navigationTimeout: 30000,
    launchOptions: { args: ['--disable-background-networking', '--no-proxy-server'] },
  },
  projects: [
    { name: 'local-real-auth-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'local-real-auth-mobile', use: { ...devices['Pixel 5'] } },
  ],
})
