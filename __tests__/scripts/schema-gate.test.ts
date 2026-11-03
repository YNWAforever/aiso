import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { gateMode, runGate } from '../../scripts/schema-gate'

const files = ['084_google_drive_connections.sql', '085_studio_drive_exports.sql', '086_work_item_edit_specs.sql']
const production = { VERCEL: '1', VERCEL_ENV: 'production', DATABASE_URL: 'postgresql://app:hunter2@ep-x.neon.tech/db' }
const preview = { ...production, VERCEL_ENV: 'preview' }

function harness(ledger: string[] | Error) {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const readLedger = vi.fn(async () => { if (ledger instanceof Error) throw ledger; return ledger })
  const printed = () => [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].flat().join('\n')
  return { log, readLedger, printed }
}

describe('gateMode', () => {
  it.each([
    [{ VERCEL: '1', VERCEL_ENV: 'production' }, 'enforce'],
    [{ VERCEL: '1', VERCEL_ENV: 'preview' }, 'warn'],
    [{ VERCEL: '1', VERCEL_ENV: 'development' }, 'warn'],
    [{}, 'skip'],
    // CI's build job sets a fixture DATABASE_URL but is not a Vercel build.
    [{ DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture' }, 'skip'],
    [{ VERCEL: '1', VERCEL_ENV: 'production', SCHEMA_GATE: 'off' }, 'skip'],
  ] as const)('%j → %s', (env, mode) => {
    expect(gateMode(env)).toBe(mode)
  })
})

describe('runGate', () => {
  it('fails a production build that ships an unrecorded migration (the 086 incident)', async () => {
    const h = harness(files.slice(0, 2))
    expect(await runGate({ env: production, files, ...h })).toBe(1)
    expect(h.log.error).toHaveBeenCalledTimes(1)
    expect(h.printed()).toContain('086_work_item_edit_specs.sql')
    expect(h.printed()).not.toContain('085_studio_drive_exports.sql')
  })

  it('passes a production build whose migrations are all recorded, extra ledger rows included', async () => {
    const h = harness(['001_phase1.sql', ...files])
    expect(await runGate({ env: production, files, ...h })).toBe(0)
    expect(h.log.error).not.toHaveBeenCalled()
  })

  it('only warns on a preview build, where migrations are expected to be pending', async () => {
    const h = harness([])
    expect(await runGate({ env: preview, files, ...h })).toBe(0)
    expect(h.log.warn).toHaveBeenCalledTimes(1)
    expect(h.printed()).toContain('086_work_item_edit_specs.sql')
  })

  it('never touches the database when skipped', async () => {
    for (const env of [{}, { ...production, SCHEMA_GATE: 'off' }]) {
      const h = harness([])
      expect(await runGate({ env, files, ...h })).toBe(0)
      expect(h.readLedger).not.toHaveBeenCalled()
    }
  })

  it('degrades to a warning, with the credential redacted, when the ledger cannot be read', async () => {
    const h = harness(new Error('connect failed for postgresql://app:hunter2@ep-x.neon.tech/db'))
    expect(await runGate({ env: production, files, ...h })).toBe(0)
    expect(h.log.warn).toHaveBeenCalledTimes(1)
    expect(h.printed()).not.toContain('hunter2')
  })

  it('degrades to a warning when DATABASE_URL is absent', async () => {
    const h = harness([])
    const { DATABASE_URL: _url, ...env } = production
    void _url
    expect(await runGate({ env, files, ...h })).toBe(0)
    expect(h.readLedger).not.toHaveBeenCalled()
  })
})

describe('wiring', () => {
  it('npm run build runs the gate before next build', () => {
    const scripts = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).scripts
    expect(scripts.build).toMatch(/^node scripts\/schema-gate\.ts && next build$/)
  })

  it('vercel.json does not override the build command (which would bypass the gate)', () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'))
    expect(vercel.buildCommand).toBeUndefined()
  })
})
