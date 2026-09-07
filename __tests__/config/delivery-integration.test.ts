import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const suite = '__tests__/integration/delivery-attestations.test.ts'
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : ''
it('never discovers delivery proofs through generic integration setup', () => {
  expect(read('vitest.integration.config.ts').split('exclude:')[1]?.split('globalSetup:')[0]).toContain(suite)
  const dedicated = read('vitest.delivery-integration.config.ts')
  expect(dedicated).toContain(`include: ['${suite}']`)
  expect(dedicated).not.toMatch(/\b(?:setupFiles|globalSetup)\s*:/)
  for (const field of ["environment: 'node'", 'fileParallelism: false', 'testTimeout: 30_000', 'hookTimeout: 60_000']) expect(dedicated).toContain(field)
})
it('requires all exact target identities and owner/application checks before fixture writes', () => {
  const source = read(suite)
  for (const field of ['C9E_DISPOSABLE_PROJECT_ID', 'C9E_DISPOSABLE_BRANCH_ID', 'C9E_TEST_DATABASE_URL', 'C9E_TEST_APP_DATABASE_URL', "current_setting('neon.project_id'", "current_setting('neon.branch_id'", 'current_database()', 'identity.database !== expectedDatabase', "identity.role !== 'aeo_app'", 'identity.owns_delivery', 'br-square-mountain-az6f82vi']) expect(source).toContain(field)
  expect(source).not.toMatch(/execSync|dotenv|process\.env\.TEST_DATABASE_URL|process\.env\.DATABASE_URL/)
  expect(source.indexOf('identity.owns_delivery')).toBeLessThan(source.indexOf('insert into accounts'))
})
