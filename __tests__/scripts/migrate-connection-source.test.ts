import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../scripts/migrate.ts', import.meta.url), 'utf8')

describe('migrate.ts connection source', () => {
  it('reads MIGRATE_DATABASE_URL', () => {
    expect(source).toContain('process.env.MIGRATE_DATABASE_URL')
  })

  it('does not fall back to DATABASE_URL', () => {
    // A fallback would run migrations as the least-privilege app role, fail
    // partway through the first DDL statement, and leave the operator guessing.
    // Failing at startup with a clear message is strictly better.
    expect(source).not.toMatch(/MIGRATE_DATABASE_URL\s*(\|\||\?\?)\s*process\.env\.DATABASE_URL/)
    expect(source).not.toContain('process.env.DATABASE_URL')
  })

  it('names the variable in the error so the fix is obvious', () => {
    expect(source).toMatch(/MIGRATE_DATABASE_URL is not set/)
  })
})
