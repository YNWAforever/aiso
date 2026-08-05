import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('npm test wiring', () => {
  it('uses the cross-platform dispatcher while preserving dedicated runners', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(packageJson.scripts.test).toBe('node scripts/run-tests.mjs')
    expect(packageJson.scripts['test:unit']).toBe("vitest run --exclude '__tests__/integration/**'")
    expect(packageJson.scripts['test:integration']).toBe('vitest run --config vitest.integration.config.ts')
  })
})
