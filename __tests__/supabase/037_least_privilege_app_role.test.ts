import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  new URL('../../supabase/migrations/037_least_privilege_app_role.sql', import.meta.url),
  'utf8',
)

/** The migration with `--` line comments stripped, so prose cannot satisfy an assertion. */
const code = sql
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

describe('037 least-privilege app role', () => {
  it('creates the role without login, so no password enters git', () => {
    expect(code).toMatch(/create\s+role\s+aeo_app[^;]*nologin/i)
    expect(code).not.toMatch(/password/i)
  })

  it('states BYPASSRLS explicitly', () => {
    // A fresh role defaults to rolbypassrls = false. Without this the seven
    // default-deny tables return zero rows silently -- the exact failure 036
    // existed to remove. Verified on a branch 2026-08-16.
    expect(code).toMatch(/create\s+role\s+aeo_app[^;]*bypassrls/i)
  })

  it('grants blanket DML on public but never DDL', () => {
    expect(code).toMatch(/grant\s+usage\s+on\s+schema\s+public\s+to\s+aeo_app/i)
    expect(code).toMatch(/grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+aeo_app/i)
    expect(code).toMatch(/grant\s+usage,\s*select\s+on\s+all\s+sequences\s+in\s+schema\s+public\s+to\s+aeo_app/i)
    expect(code).not.toMatch(/grant\s+all\b/i)
    expect(code).not.toMatch(/grant[^;]*\bcreate\b[^;]*to\s+aeo_app/i)
    expect(code).not.toMatch(/\bsuperuser\b|\bcreaterole\b/i)
  })

  it('sets default privileges so a later migration cannot create an unreadable table', () => {
    expect(code).toMatch(/alter\s+default\s+privileges[^;]*on\s+tables\s+to\s+aeo_app/i)
    expect(code).toMatch(/alter\s+default\s+privileges[^;]*on\s+sequences\s+to\s+aeo_app/i)
  })

  it('grants read-only access to neon_auth."user" and nothing more', () => {
    expect(code).toMatch(/grant\s+usage\s+on\s+schema\s+neon_auth\s+to\s+aeo_app/i)
    expect(code).toMatch(/grant\s+select\s+on\s+neon_auth\.[^;]*to\s+aeo_app/i)
    // Read access must not carry write access, and session data is not the
    // app's business.
    expect(code).not.toMatch(/grant[^;]*(insert|update|delete)[^;]*neon_auth/i)
    expect(code).not.toMatch(/neon_auth\.\"?session\"?/i)
  })

  it('leaves the dead auth schema alone', () => {
    expect(code).not.toMatch(/\bauth\.\w/i)
  })

  it('fails closed if BYPASSRLS did not take effect', () => {
    expect(code).toMatch(/rolbypassrls/i)
    expect(code).toMatch(/raise\s+exception/i)
  })

  it('is re-runnable', () => {
    expect(code).toMatch(/to_regrole\(\s*'aeo_app'\s*\)/i)
  })
})
