import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const suite = '__tests__/integration/change-set-approvals.test.ts'
it('isolates the explicitly authorized disposable proof from generic provisioning', () => {
  const path = 'vitest.change-sets-integration.config.ts'
  expect(existsSync(path)).toBe(true)
  const source = existsSync(path) ? readFileSync(path,'utf8') : ''
  expect(source).toContain(`include: ['${suite}']`)
  expect(source).toContain('fileParallelism: false')
  expect(source).not.toMatch(/\b(?:setupFiles|globalSetup)\s*:/)
  expect(readFileSync('vitest.integration.config.ts','utf8').split('exclude:')[1]?.split('globalSetup:')[0]).toContain(suite)
})
it('requires exact dedicated identities before fixture writes', () => {
  const source = existsSync(suite) ? readFileSync(suite,'utf8') : ''
  for (const key of ['C9D_DISPOSABLE_PROJECT_ID','C9D_DISPOSABLE_BRANCH_ID','C9D_TEST_DATABASE_URL',"current_setting('neon.project_id'", "current_setting('neon.branch_id'"]) expect(source).toContain(key)
  expect(source).not.toMatch(/globalSetup|execSync|dotenv|process\.env\.TEST_DATABASE_URL/)
})
