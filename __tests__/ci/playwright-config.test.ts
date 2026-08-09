import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')

describe('Playwright CI server isolation', () => {
  it('starts CI from an isolated working directory that excludes local environment files', async () => {
    const [config, launcher] = await Promise.all([
      readFile(resolve(root, 'playwright.config.ts'), 'utf8'),
      readFile(resolve(root, 'scripts/start-playwright-ci-server.cjs'), 'utf8'),
    ])

    expect(config).toContain("isCi ? 'node scripts/start-playwright-ci-server.cjs' : 'npm run dev'")
    expect(config).toContain("url: 'http://127.0.0.1:3000'")
    expect(config).toContain('retries: 0')
    expect(config).toContain("trace: 'retain-on-failure'")
    expect(config).toContain('reuseExistingServer: false')
    expect(launcher).toContain("entry !== '.env.local'")
    expect(launcher).toContain("entry.endsWith('.local')")
    expect(launcher).toContain('cwd: isolatedRoot')
  })
})
