import { describe, expect, it } from 'vitest'

import { validateConfiguration, type ReleasePolicy } from '@/lib/readiness/config'

const policy: ReleasePolicy = {
  expected: {
    project: 'project-test',
    branch: 'br-test',
    role: 'aeo_app',
    database: 'neondb',
  },
  capabilities: {
    claims: 'unknown',
    ai: 'unknown',
    billing: 'unknown',
    email: 'unknown',
    scheduler: 'unknown',
  },
}

const validEnv = {
  DATABASE_URL: 'postgresql://aeo_app:fake-password@db.fixture.invalid/neondb',
  NEON_AUTH_BASE_URL: 'https://auth.fixture.invalid',
  NEON_AUTH_COOKIE_SECRET: 'c'.repeat(32),
  PUBLIC_SCAN_RATE_LIMIT_SECRET: 'r'.repeat(32),
  NEXT_PUBLIC_APP_URL: 'https://app.fixture.invalid',
  VERCEL: '1',
  EXPECTED_NEON_PROJECT_ID: 'project-test',
  EXPECTED_NEON_BRANCH_ID: 'br-test',
  EXPECTED_DB_ROLE: 'aeo_app',
  EXPECTED_DB_NAME: 'neondb',
} as const

function status(checks: ReturnType<typeof validateConfiguration>, id: string) {
  return checks.find((check) => check.id === id)?.status
}

describe('configuration readiness', () => {
  it('collects all absent core requirements without echoing input', () => {
    const checks = validateConfiguration({ DATABASE_URL: 'credential-sentinel' }, policy)

    expect(status(checks, 'config.DATABASE_URL')).toBe('fail')
    expect(status(checks, 'config.NEON_AUTH_COOKIE_SECRET')).toBe('fail')
    expect(status(checks, 'config.PUBLIC_SCAN_RATE_LIMIT_SECRET')).toBe('fail')
    expect(status(checks, 'capability.ai')).toBe('unknown')
    expect(JSON.stringify(checks)).not.toContain('credential-sentinel')
  })

  it('passes valid core configuration while preserving unknown capabilities', () => {
    const checks = validateConfiguration(validEnv, policy)

    expect(checks.filter((check) => check.id.startsWith('config.'))).toHaveLength(6)
    expect(checks.filter((check) => check.id.startsWith('config.')).every((check) => check.status === 'pass')).toBe(true)
    expect(checks.filter((check) => check.id.startsWith('binding.')).every((check) => check.status === 'pass')).toBe(true)
    expect(status(checks, 'capability.ai')).toBe('unknown')
  })

  it.each(['', ' ', 'x'.repeat(31)])('rejects an unusable cookie secret', (value) => {
    const checks = validateConfiguration({ ...validEnv, NEON_AUTH_COOKIE_SECRET: value }, policy)

    expect(status(checks, 'config.NEON_AUTH_COOKIE_SECRET')).toBe('fail')
  })

  it.each([
    ['NEON_AUTH_BASE_URL', 'http://auth.fixture.invalid'],
    ['NEON_AUTH_BASE_URL', 'https://user:password@auth.fixture.invalid'],
    ['NEXT_PUBLIC_APP_URL', 'https://app.fixture.invalid?secret=value'],
    ['DATABASE_URL', 'https://aeo_app:password@db.fixture.invalid/neondb'],
    ['DATABASE_URL', 'not a url'],
  ])('rejects invalid %s values', (key, value) => {
    const checks = validateConfiguration({ ...validEnv, [key]: value }, policy)

    expect(status(checks, `config.${key}`)).toBe('fail')
  })

  it.each([
    ['EXPECTED_NEON_PROJECT_ID', 'binding.EXPECTED_NEON_PROJECT_ID'],
    ['EXPECTED_NEON_BRANCH_ID', 'binding.EXPECTED_NEON_BRANCH_ID'],
    ['EXPECTED_DB_ROLE', 'binding.EXPECTED_DB_ROLE'],
    ['EXPECTED_DB_NAME', 'binding.EXPECTED_DB_NAME'],
  ])('fails when identity field %s is absent', (key, checkId) => {
    const checks = validateConfiguration({ ...validEnv, [key]: undefined }, policy)

    expect(status(checks, checkId)).toBe('fail')
  })

  it('requires the application role rather than an owner role', () => {
    const ownerPolicy: ReleasePolicy = {
      ...policy,
      expected: { ...policy.expected, role: 'neondb_owner' },
    }
    const checks = validateConfiguration({
      ...validEnv,
      DATABASE_URL: 'postgresql://neondb_owner:fake-password@db.fixture.invalid/neondb',
      EXPECTED_DB_ROLE: 'neondb_owner',
    }, ownerPolicy)

    expect(status(checks, 'binding.connection_role')).toBe('fail')
  })

  it('fails when the connection uses an unexpected database', () => {
    const checks = validateConfiguration({
      ...validEnv,
      DATABASE_URL: 'postgresql://aeo_app:fake-password@db.fixture.invalid/otherdb',
    }, policy)

    expect(status(checks, 'binding.connection_database')).toBe('fail')
  })

  it.each([
    ['FORBIDDEN_NEON_PROJECT_IDS', 'other, project-test'],
    ['FORBIDDEN_NEON_BRANCH_IDS', 'br-test, other'],
    ['FORBIDDEN_DB_HOSTS', 'db.fixture.invalid'],
  ])('fails when %s contains the selected target', (key, value) => {
    const checks = validateConfiguration({ ...validEnv, [key]: value }, policy)

    expect(status(checks, 'binding.forbidden_target')).toBe('fail')
  })

  it.each([
    'postgresql://aeo%ZZ_app:fake-password@db.fixture.invalid/neondb',
    'postgresql://aeo_app:fake-password@db.fixture.invalid/neo%ZZdb',
  ])('fails malformed percent encoding without throwing', (databaseUrl) => {
    expect(() => validateConfiguration({ ...validEnv, DATABASE_URL: databaseUrl }, policy)).not.toThrow()

    const checks = validateConfiguration({ ...validEnv, DATABASE_URL: databaseUrl }, policy)
    expect([
      status(checks, 'binding.connection_role'),
      status(checks, 'binding.connection_database'),
    ]).toContain('fail')
  })

  it('does not suppress required AI configuration', () => {
    const checks = validateConfiguration({}, {
      ...policy,
      capabilities: { ...policy.capabilities, ai: 'required' },
    })

    expect(status(checks, 'config.OPENROUTER_API_KEY')).toBe('fail')
  })

  it('keeps verified-disabled as caller-supplied policy metadata', () => {
    const checks = validateConfiguration(validEnv, {
      ...policy,
      capabilities: { ...policy.capabilities, email: 'verified-disabled' },
    })

    expect(checks.find((check) => check.id === 'capability.email')).toEqual({
      id: 'capability.email',
      status: 'pass',
      code: 'verified-disabled',
    })
    expect(checks.some((check) => check.id === 'config.RESEND_API_KEY')).toBe(false)
  })
})
