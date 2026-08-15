import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts/verify-db-connection.mjs')
const SOURCE = readFileSync(SCRIPT, 'utf8')

describe('verify-db-connection', () => {
  it('never prints the DSN itself', () => {
    // The whole point is that its output is safe to share.
    expect(SOURCE).not.toMatch(/console\.log\([^)]*DATABASE_URL/)
    expect(SOURCE).toContain('redactSecrets')
  })

  it('reports the host so the operator can tell which database answered', () => {
    expect(SOURCE).toContain('hostname')
  })

  it('exits non-zero with a clear message when DATABASE_URL is unset', () => {
    let code = 0
    let output = ''
    try {
      output = execFileSync('node', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      const e = error as { status: number; stdout: string; stderr: string }
      code = e.status
      output = `${e.stdout}${e.stderr}`
    }

    expect(code).not.toBe(0)
    expect(output).toMatch(/DATABASE_URL/)
  })
})
