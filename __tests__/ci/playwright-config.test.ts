import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const { createIsolatedWorkspace } = require(resolve(root, 'scripts/start-playwright-ci-server.cjs')) as {
  createIsolatedWorkspace: (repositoryRoot: string, isolatedRoot: string) => void
}

describe('Playwright CI server isolation', () => {
  it('uses the isolated launcher with the required CI Playwright settings', async () => {
    const config = await readFile(resolve(root, 'playwright.config.ts'), 'utf8')

    expect(config).toContain("isCi ? 'node scripts/start-playwright-ci-server.cjs' : 'npm run dev'")
    expect(config).toContain("url: 'http://127.0.0.1:3000'")
    expect(config).toContain('retries: 0')
    expect(config).toContain("trace: 'retain-on-failure'")
    expect(config).toContain('reuseExistingServer: false')
  })

  it('copies ordinary project files while excluding local environment files', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'playwright-ci-source-'))
    const isolatedRoot = await mkdtemp(join(tmpdir(), 'playwright-ci-target-'))

    try {
      await writeFile(join(fixtureRoot, 'package.json'), '{"name":"fixture"}')
      await writeFile(join(fixtureRoot, '.env.local'), 'SENTINEL_ENV=must-not-copy')
      await writeFile(join(fixtureRoot, 'settings.local'), 'SENTINEL_LOCAL=must-not-copy')

      createIsolatedWorkspace(fixtureRoot, isolatedRoot)

      await expect(readFile(join(isolatedRoot, 'package.json'), 'utf8')).resolves.toContain('fixture')
      expect(existsSync(join(isolatedRoot, '.env.local'))).toBe(false)
      expect(existsSync(join(isolatedRoot, 'settings.local'))).toBe(false)
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true })
      await rm(isolatedRoot, { force: true, recursive: true })
    }
  })
})
