import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { assertBuildIpc, offlineBuildEnvironment } from '../../scripts/ci/build-offline.mjs'

describe('offline build environment', () => {
  it('removes dotenv settings and cost-bearing credentials without changing the caller environment', () => {
    const ambient = { PATH: 'runtime-path', DATABASE_URL: 'private-dsn', OPENROUTER_API_KEY: 'provider-value',
      N8N_API_KEY: 'n8n-value', RESEND_API_KEY: 'mail-value', STRIPE_SECRET_KEY: 'payment-value', PRIVATE_SETTING: 'private-value',
      neon_auth_base_url: 'https://private-auth.invalid' }
    const before = { ...ambient }
    const result = offlineBuildEnvironment(ambient, ['# comment\nexport PRIVATE_SETTING="sensitive"\nOPENROUTER_API_KEY="sensitive"\n'])
    for (const key of ['DATABASE_URL', 'OPENROUTER_API_KEY', 'N8N_API_KEY', 'RESEND_API_KEY', 'STRIPE_SECRET_KEY', 'PRIVATE_SETTING']) {
      expect(result[key]).toBe('')
    }
    expect(result.PATH).toBe('runtime-path')
    expect(result.NEON_AUTH_BASE_URL).toBe('https://fixture.invalid')
    expect(result.NEON_AUTH_COOKIE_SECRET.length).toBeGreaterThanOrEqual(32)
    expect(result.NEXT_PUBLIC_APP_URL).toBe('http://127.0.0.1:3000')
    expect(result).not.toHaveProperty('neon_auth_base_url')
    expect(result.NEXT_TELEMETRY_DISABLED).toBe('1')
    expect(result.NODE_ENV).toBe('production')
    expect(result.FEATURE_PULSE_ATTEMPTS).toBe('false')
    expect(ambient).toEqual(before)
  })
  it('blanks every key accepted by the installed Next dotenv parser, including colon and multiline syntax', () => {
    const source = "AISO_COMPAT_COLON: value\r\nexport AISO_COMPAT_EXPORT='value'\r\nAISO.COMPAT.DOTTED=value\r\n1_AISO_KEY: value\r\nAISO-COMPAT-HYPHEN=value\r\nAISO_COMPAT_MULTILINE=\"first\nUNRELATED_RUNTIME_KEY=inside-only\nlast\"\nAISO_COMPAT_BACKTICK=`first\nlast`\n"
    // Only test data from stdin is parsed. No dotenv file or app is loaded.
    const parsed = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import env from '@next/env';import{readFileSync}from'node:fs';const files=[{path:'.env.offline.fixture',contents:readFileSync(0,'utf8')}];env.processEnv(files,process.cwd(),console,true);process.stdout.write(JSON.stringify(Object.keys(files[0].env)));"],
    { input: source, encoding: 'utf8' })
    expect(parsed.status, parsed.stderr).toBe(0)
    const names = JSON.parse(parsed.stdout)
    expect(names).toContain('AISO_COMPAT_COLON')
    expect(names).toContain('AISO_COMPAT_MULTILINE')
    expect(names).not.toContain('UNRELATED_RUNTIME_KEY')
    const result = offlineBuildEnvironment({ UNRELATED_RUNTIME_KEY: 'runtime-value' }, [source])
    for (const key of names) expect(result[key], key).toBe('')
    expect(result.UNRELATED_RUNTIME_KEY).toBe('runtime-value')
  })
  it('does not leak a live setting through a case-only duplicate in a Windows child environment', () => {
    const result = offlineBuildEnvironment({ AISO_OFFLINE_CASE_FIXTURE: 'fixture-only' },
      ['aiso_offline_case_fixture: fixture-only\n'])
    const liveValues = Object.entries(result).filter(([key]) => key.toLowerCase() === 'aiso_offline_case_fixture')
    expect(liveValues).toEqual([['aiso_offline_case_fixture', '']])
    const child = spawnSync(process.execPath, ['-e',
      "process.stdout.write(JSON.stringify({upper:process.env.AISO_OFFLINE_CASE_FIXTURE??null,lower:process.env.aiso_offline_case_fixture??null}))"],
    { env: result, encoding: 'utf8' })
    expect(child.status, child.stderr).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual(process.platform === 'win32'
      ? { upper: '', lower: '' } : { upper: null, lower: '' })
  })
})

describe('Turbopack child-process IPC preflight', () => {
  it('verifies a real child can exchange data with its own ephemeral loopback listener', async () => {
    expect(await assertBuildIpc()).toEqual({ connected: true })
  })
  it('rejects a child that exits zero before connecting, rather than reporting success', async () => {
    const spawnProcess = () => {
      const child = new EventEmitter()
      child.kill = () => true
      queueMicrotask(() => child.emit('close', 0))
      return child
    }
    await expect(assertBuildIpc({ spawnProcess })).rejects.toThrow('BUILD_IPC_UNAVAILABLE')
  })
  it('reports a safe diagnostic when child creation fails', async () => {
    const spawnProcess = () => {
      const child = new EventEmitter()
      child.kill = () => true
      queueMicrotask(() => child.emit('error', new Error('PRIVATE_DRIVER_DETAIL')))
      return child
    }
    await expect(assertBuildIpc({ spawnProcess })).rejects.toThrow(/^BUILD_IPC_UNAVAILABLE$/)
  })
  it('bounds a child that never connects and releases the listener', async () => {
    const spawnProcess = () => {
      const child = new EventEmitter()
      child.kill = () => true
      return child
    }
    await expect(assertBuildIpc({ spawnProcess, timeoutMs: 30 })).rejects.toThrow('BUILD_IPC_UNAVAILABLE')
  })
})
