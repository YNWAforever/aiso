import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkBinding, readExpectationFromEnv } from '@/lib/security/db-binding'

/**
 * The pure half of the connection-binding guard.
 *
 * On 2026-09-05 `.env.local`'s DATABASE_URL was found pointing at the AISO
 * project as `neondb_owner` — the owner role, with DDL rights the application
 * is explicitly designed not to have — and had been since 2026-09-02. No test,
 * no CI job and no runtime check noticed; a human running
 * scripts/verify-db-connection.mjs by hand did.
 *
 * A CI-only test could not have caught it: CI verifies CI's own binding, which
 * was never the one that was wrong. So the guard runs in the query path, and
 * this module is the decision it makes — an observed tuple plus an expectation
 * in, a verdict out. Pure, so every case below is exercised without a database.
 */

const observed = {
  projectId: 'weathered-wave-50814522',
  branchId: 'br-square-mountain-az6f82vi',
  role: 'aeo_app',
  database: 'neondb',
  host: 'ep-mute-firefly-azxacr80-pooler.c-3.ap-southeast-1.aws.neon.tech',
}

describe('checkBinding', () => {
  it('accepts a matching binding', () => {
    expect(checkBinding(observed, { projectId: observed.projectId }).ok).toBe(true)
  })

  it('rejects a wrong project id, naming both values', () => {
    const v = checkBinding(observed, { projectId: 'some-other-project' })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/project/i)
    expect(v.reason).toContain('some-other-project')
    expect(v.reason).toContain('weathered-wave-50814522')
  })

  it('throws when the mandatory project expectation is absent', () => {
    expect(() => checkBinding(observed, {})).toThrow(/EXPECTED_NEON_PROJECT_ID/)
  })

  it('ignores branch, role and database when their expectations are unset', () => {
    expect(checkBinding(observed, { projectId: observed.projectId }).ok).toBe(true)
  })

  it('rejects a wrong branch id when that expectation is set', () => {
    expect(
      checkBinding(observed, { projectId: observed.projectId, branchId: 'br-wrong' }).ok,
    ).toBe(false)
  })

  it('rejects a wrong role when that expectation is set', () => {
    expect(
      checkBinding(observed, { projectId: observed.projectId, role: 'neondb_owner' }).ok,
    ).toBe(false)
  })

  it('rejects a wrong database when that expectation is set', () => {
    expect(
      checkBinding(observed, { projectId: observed.projectId, database: 'other' }).ok,
    ).toBe(false)
  })

  it('rejects a blocklisted project even when the allow-list matches', () => {
    const v = checkBinding(observed, {
      projectId: observed.projectId,
      forbiddenProjectIds: [observed.projectId],
    })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/forbidden/i)
  })

  it('rejects a blocklisted branch id', () => {
    const v = checkBinding(observed, {
      projectId: observed.projectId,
      forbiddenBranchIds: [observed.branchId],
    })
    expect(v.ok).toBe(false)
  })

  it('rejects a blocklisted host', () => {
    const v = checkBinding(observed, {
      projectId: observed.projectId,
      forbiddenHosts: [observed.host],
    })
    expect(v.ok).toBe(false)
  })

  it('never includes a password or DSN in the reason', () => {
    const v = checkBinding(
      { ...observed, host: 'postgresql://aeo_app:hunter2@host/db' },
      { projectId: 'other' },
    )
    expect(v.reason).not.toContain('hunter2')
    expect(v.reason).not.toContain('postgresql://')
  })

  it('redacts a credential that reaches the reason through a forbidden host', () => {
    const v = checkBinding(
      { ...observed, host: 'postgresql://aeo_app:hunter2@evil.example/db' },
      {
        projectId: observed.projectId,
        forbiddenHosts: ['postgresql://aeo_app:hunter2@evil.example/db'],
      },
    )
    expect(v.ok).toBe(false)
    expect(v.reason).not.toContain('hunter2')
  })

  // A GUC that is absent reads as null rather than raising — the same
  // fail-closed shape __tests__/integration/setup.ts relies on.
  it('fails closed when the project GUC is absent', () => {
    const v = checkBinding({ ...observed, projectId: null }, { projectId: observed.projectId })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/project/i)
  })

  it('fails closed when the branch GUC is absent and a branch is expected', () => {
    const v = checkBinding(
      { ...observed, branchId: null },
      { projectId: observed.projectId, branchId: observed.branchId },
    )
    expect(v.ok).toBe(false)
  })

  it('treats an empty blocklist as no blocklist', () => {
    expect(
      checkBinding(observed, {
        projectId: observed.projectId,
        forbiddenProjectIds: [],
        forbiddenBranchIds: [],
        forbiddenHosts: [],
      }).ok,
    ).toBe(true)
  })
})

describe('readExpectationFromEnv', () => {
  const VARS = [
    'EXPECTED_NEON_PROJECT_ID',
    'EXPECTED_NEON_BRANCH_ID',
    'EXPECTED_DB_ROLE',
    'EXPECTED_DB_NAME',
    'FORBIDDEN_NEON_PROJECT_IDS',
    'FORBIDDEN_NEON_BRANCH_IDS',
    'FORBIDDEN_DB_HOSTS',
  ] as const

  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = {}
    for (const key of VARS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of VARS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('reads all seven variables', () => {
    process.env.EXPECTED_NEON_PROJECT_ID = 'proj'
    process.env.EXPECTED_NEON_BRANCH_ID = 'br-x'
    process.env.EXPECTED_DB_ROLE = 'aeo_app'
    process.env.EXPECTED_DB_NAME = 'neondb'
    process.env.FORBIDDEN_NEON_PROJECT_IDS = 'a,b'
    process.env.FORBIDDEN_NEON_BRANCH_IDS = 'br-a,br-b'
    process.env.FORBIDDEN_DB_HOSTS = 'h1,h2'

    expect(readExpectationFromEnv()).toEqual({
      projectId: 'proj',
      branchId: 'br-x',
      role: 'aeo_app',
      database: 'neondb',
      forbiddenProjectIds: ['a', 'b'],
      forbiddenBranchIds: ['br-a', 'br-b'],
      forbiddenHosts: ['h1', 'h2'],
    })
  })

  it('splits the blocklists on commas and trims each entry', () => {
    process.env.EXPECTED_NEON_PROJECT_ID = 'proj'
    process.env.FORBIDDEN_NEON_PROJECT_IDS = ' a , b ,c '
    process.env.FORBIDDEN_NEON_BRANCH_IDS = '  br-a  '
    process.env.FORBIDDEN_DB_HOSTS = 'h1 ,  h2'

    const expectation = readExpectationFromEnv()
    expect(expectation.forbiddenProjectIds).toEqual(['a', 'b', 'c'])
    expect(expectation.forbiddenBranchIds).toEqual(['br-a'])
    expect(expectation.forbiddenHosts).toEqual(['h1', 'h2'])
  })

  it('drops empty blocklist entries rather than forbidding the empty string', () => {
    process.env.EXPECTED_NEON_PROJECT_ID = 'proj'
    process.env.FORBIDDEN_NEON_PROJECT_IDS = 'a,,  ,b,'
    expect(readExpectationFromEnv().forbiddenProjectIds).toEqual(['a', 'b'])
  })

  it('leaves the optional fields undefined when unset or blank', () => {
    process.env.EXPECTED_NEON_PROJECT_ID = 'proj'
    process.env.EXPECTED_NEON_BRANCH_ID = '   '

    const expectation = readExpectationFromEnv()
    expect(expectation.projectId).toBe('proj')
    // Blank, not unset: GitHub Actions substitutes '' for a missing secret, and
    // an expectation of '' would compare unequal to every real branch id and
    // so fail every query. Treat it as absent.
    expect(expectation.branchId).toBeUndefined()
    expect(expectation.role).toBeUndefined()
    expect(expectation.database).toBeUndefined()
    expect(expectation.forbiddenProjectIds).toEqual([])
  })

  it('leaves projectId undefined when unset, so checkBinding throws', () => {
    expect(readExpectationFromEnv().projectId).toBeUndefined()
    expect(() => checkBinding(observed, readExpectationFromEnv())).toThrow(
      /EXPECTED_NEON_PROJECT_ID/,
    )
  })
})
