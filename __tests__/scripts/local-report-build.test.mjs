import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import { evidenceMode, runSpec } from '../../scripts/ci/local-auth-safety.mjs'
const tools = await import('../../scripts/ci/local-report-build.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
  throw error
})
const config = () => ({
  ...runSpec('11111111-1111-4111-8111-111111111111', `sha256:${'a'.repeat(64)}`),
  scenario: 'report-recovery', mode: evidenceMode, containerVerified: true,
  containerId: 'b'.repeat(64), dbHost: '127.0.0.1',
  appOrigin: 'https://127.0.0.1:44441', allowedOrigins: ['https://127.0.0.1:44441', 'https://127.0.0.1:44442'],
})
it('builds only the owned HTTPS origin while keeping database, provider and preload credentials cleared', () => {
  expect(typeof tools.localReportBuildEnvironment).toBe('function')
  const env = tools.localReportBuildEnvironment({
    Path: 'safe', DATABASE_URL: 'live-db', REPORT_SHARE_SECRET: 'live-share',
    OPENROUTER_API_KEY: 'live-provider', NODE_OPTIONS: '--require unwanted',
  }, ['OTHER_PROVIDER_TOKEN=live-other'], config())
  expect(env.NEXT_PUBLIC_APP_URL).toBe('https://127.0.0.1:44441')
  expect(env.NODE_ENV).toBe('production')
  expect(env.DATABASE_URL).toBe('')
  expect(env.REPORT_SHARE_SECRET).toBe('')
  expect(env.OTHER_PROVIDER_TOKEN).toBe('')
  expect(env.FEATURE_PULSE_ATTEMPTS).toBe('false')
  expect(env.NODE_OPTIONS).toBe('')
  expect(env.NEON_AUTH_BASE_URL).toBe('https://fixture.invalid')
  expect(JSON.stringify(env)).not.toMatch(/live-|unwanted/)
})
it('permits report-list on the verified local HTTPS target without enabling providers or monitoring', () => {
  const env = tools.localReportBuildEnvironment({}, [], { ...config(), scenario: 'report-list' })
  expect(env.NEXT_PUBLIC_APP_URL).toBe('https://127.0.0.1:44441')
  expect(env.DATABASE_URL).toBe('')
  expect(env.OPENROUTER_API_KEY).toBe('')
  expect(env.FEATURE_PULSE_ATTEMPTS).toBe('false')
})
it('permits report-multi only with the same owned build isolation', () => {
  const env = tools.localReportBuildEnvironment({}, [], { ...config(), scenario: 'report-multi' })
  expect(env.NEXT_PUBLIC_APP_URL).toBe('https://127.0.0.1:44441')
  expect(env.DATABASE_URL).toBe('')
  expect(env.NEON_AUTH_BASE_URL).toBe('https://fixture.invalid')
  expect(env.OPENROUTER_API_KEY).toBe('')
  expect(env.FEATURE_PULSE_ATTEMPTS).toBe('false')
})
it('permits report-conflict only with the same owned build isolation', () => {
  const env = tools.localReportBuildEnvironment({}, [], { ...config(), scenario: 'report-conflict' })
  expect(env.NEXT_PUBLIC_APP_URL).toBe('https://127.0.0.1:44441')
  expect(env.DATABASE_URL).toBe('')
  expect(env.NEON_AUTH_BASE_URL).toBe('https://fixture.invalid')
  expect(env.OPENROUTER_API_KEY).toBe('')
  expect(env.FEATURE_PULSE_ATTEMPTS).toBe('false')
})
it('rejects remote, HTTP, unowned or malformed origins and target metadata before any build', () => {
  expect(typeof tools.localReportBuildEnvironment).toBe('function')
  for (const patch of [
    { appOrigin: 'http://127.0.0.1:44441' }, { appOrigin: 'https://production.example' },
    { appOrigin: 'https://127.0.0.1:44441/path' }, { appOrigin: 'https://127.0.0.1:44443' },
    { appOrigin: 'https://127.0.0.1' }, { containerVerified: false }, { containerId: 'unknown' },
    { dbHost: 'shared-host' }, { database: 'shared-db' }, { scenario: 'first-value' }, { mode: 'production' },
  ]) expect(() => tools.localReportBuildEnvironment({}, [], { ...config(), ...patch })).toThrow('LOCAL_AUTH_BUILD_TARGET')
})
it('retains the IPC prerequisite and executes only the sanitized production build', async () => {
  expect(typeof tools.buildLocalReportRuntime).toBe('function')
  let spawned = 0
  await expect(tools.buildLocalReportRuntime('.', config(), {}, [], () => {}, {
    verifyIpc: async () => { throw new Error('BUILD_IPC_UNAVAILABLE') },
    spawnProcess: () => { spawned++; throw new Error('Must not spawn') },
  })).rejects.toThrow('BUILD_IPC_UNAVAILABLE')
  expect(spawned).toBe(0)
  const result = await tools.buildLocalReportRuntime('.', config(), {}, [], () => {}, {
    verifyIpc: async () => ({ connected: true }),
    spawnProcess: (_exe, args, options) => {
      spawned++
      expect(args.at(-1)).toBe('build')
      expect(options.env.NEXT_PUBLIC_APP_URL).toBe(config().appOrigin)
      expect(options.env.DATABASE_URL).toBe('')
      expect(options.env.OPENROUTER_API_KEY).toBe('')
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
      queueMicrotask(() => child.emit('close', 0))
      return child
    },
  })
  expect(result.exitCode).toBe(0)
  expect(result.ipcVerified).toBe(true)
  expect(result.credentialsCleared).toBe(true)
  expect(spawned).toBe(1)
})
