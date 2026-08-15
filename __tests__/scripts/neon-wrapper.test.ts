import { execFileSync } from 'node:child_process'
import { accessSync, constants, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const WRAPPER = join(process.cwd(), 'scripts/neon')
const FILTER = join(process.cwd(), 'scripts/redact.mjs')

describe('scripts/redact.mjs', () => {
  it('redacts a connection URI piped through stdin', () => {
    const out = execFileSync('node', [FILTER], {
      input: 'postgresql://neondb_owner:npg_yxgMD67vcGVS@ep-x.aws.neon.tech/neondb\n',
      encoding: 'utf8',
    })

    expect(out).not.toContain('npg_yxgMD67vcGVS')
    expect(out).toContain('ep-x.aws.neon.tech')
  })

  it('passes clean output through unchanged', () => {
    const out = execFileSync('node', [FILTER], { input: 'all good\n', encoding: 'utf8' })
    expect(out).toBe('all good\n')
  })
})

describe('scripts/neon', () => {
  it('is executable', () => {
    // A wrapper nobody can run is a wrapper nobody will use.
    expect(() => accessSync(WRAPPER, constants.X_OK)).not.toThrow()
  })

  it('routes both stdout and stderr through the redactor', () => {
    // neonctl prints the connection URI on stdout for `branches create` and
    // the driver echoes DSNs on stderr, so redirecting only one is a hole.
    const src = readFileSync(WRAPPER, 'utf8')

    expect(src).toContain('redact.mjs')
    expect(src).toMatch(/2>&1/)
  })

  it('fails loudly rather than silently printing raw output if the filter is missing', () => {
    const src = readFileSync(WRAPPER, 'utf8')
    expect(src).toMatch(/set -euo pipefail/)
  })
})
