import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { evidenceMode, localEnvironment } from '../../scripts/ci/local-auth-safety.mjs'

for (const [scenario, file] of [['first-value', 'first-value.spec.mjs'], ['brand-isolation', 'brand-isolation.spec.mjs'], ['auth-rate-limit', 'auth-rate-limit.spec.mjs'], ['login-rate-limit', 'login-rate-limit.spec.mjs'], ['account-unlock-rate-limit', 'account-unlock-rate-limit.spec.mjs'], ['report-recovery', 'report-recovery.spec.mjs'], ['report-list', 'report-list.spec.mjs'], ['report-multi', 'report-multi.spec.mjs'], ['report-conflict', 'report-conflict.spec.mjs']]) {
  it(`discovers only the expected requested ${scenario} cases without starting a runtime`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiso-local-auth-discovery-')), config = join(dir, 'discovery-only.json')
    writeFileSync(config, JSON.stringify({
      mode: evidenceMode, scenario, containerVerified: true, discoveryOnly: true,
      runId: '11111111-1111-4111-8111-111111111111', output: dir,
      appOrigin: 'https://127.0.0.1:44441', authOrigin: 'https://127.0.0.1:44442',
    }))
    try {
      const env = localEnvironment(process.env)
      env.AISO_LOCAL_AUTH_CONFIG = config
      env.NODE_OPTIONS = `--import=${pathToFileURL(resolve('tests/fixtures/no-outbound-runtime.mjs')).href}`
      const text = execFileSync(process.execPath, [
        'node_modules/@playwright/test/cli.js', 'test', '--config=tests/local-auth/playwright.config.mjs',
        '--list', '--reporter=json',
      ], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 2 * 1024 * 1024, timeout: 20000 })
      const value = JSON.parse(text), cases = []
      const walk = suite => {
        for (const spec of suite.specs ?? []) for (const entry of spec.tests ?? []) cases.push({ file: spec.file, title: spec.title, project: entry.projectName })
        for (const nested of suite.suites ?? []) walk(nested)
      }
      walk(value)
      const expectedCases = scenario === 'report-conflict' ? 8 : 4
      expect(cases).toHaveLength(expectedCases)
      expect(cases.every(row => resolve(value.config.rootDir, row.file) === resolve('tests/local-auth', file))).toBe(true)
      for (const project of ['local-real-auth-desktop', 'local-real-auth-mobile']) {
        expect(cases.filter(row => row.project === project)).toHaveLength(expectedCases / 2)
        for (const lang of ['en', 'zh-HK']) expect(cases.some(row => row.project === project && row.title.startsWith(`${lang} `))).toBe(true)
      }
    } finally { unlinkSync(config); rmdirSync(dir) }
  }, 25000)
}
