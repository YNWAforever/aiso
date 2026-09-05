import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENV_KEYS = ['NEON_TEST_PROJECT_ID', 'NEON_TEST_PRODUCTION_BRANCH_ID'] as const
const originalValues: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) originalValues[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalValues[key] === undefined) delete process.env[key]
    else process.env[key] = originalValues[key]
  }
})

describe('neon-branch harness configuration', () => {
  it('defaults to the known project and production branch when unset', async () => {
    delete process.env.NEON_TEST_PROJECT_ID
    delete process.env.NEON_TEST_PRODUCTION_BRANCH_ID
    vi.resetModules()
    const mod = await import('../helpers/neon-branch')

    expect(mod.PROJECT_ID).toBe('weathered-wave-50814522')
    expect(mod.PRODUCTION_BRANCH_ID).toBe('br-square-mountain-az6f82vi')
  })

  /**
   * The rule rather than the values, so this keeps its meaning if the ids ever
   * change — which the test above does not.
   *
   * createTestBranch() passes no --parent, so a branch's parent is whatever the
   * project's default branch is, and a Neon branch is a copy-on-write snapshot
   * of its parent rather than an empty database. The harness then runs
   * `drop schema public cascade` against that copy. Defaulting PROJECT_ID to a
   * project whose default branch holds customer data therefore snapshots real
   * data on every unconfigured run — which is what this defaulted to until
   * 2026-09-05. Section 16.1: never create a preview or test branch from a
   * branch that has held customer data.
   */
  it('never defaults to a project or branch that has held customer data', async () => {
    delete process.env.NEON_TEST_PROJECT_ID
    delete process.env.NEON_TEST_PRODUCTION_BRANCH_ID
    vi.resetModules()
    const mod = await import('../helpers/neon-branch')

    expect(mod.PROJECT_ID).not.toBe('red-firefly-93523049')
    expect(mod.PRODUCTION_BRANCH_ID).not.toBe('br-rough-butterfly-aojtgi92')
  })

  it('reads an injected project id when set', async () => {
    process.env.NEON_TEST_PROJECT_ID = 'injected-project-id'
    process.env.NEON_TEST_PRODUCTION_BRANCH_ID = 'br-injected-production'
    vi.resetModules()
    const mod = await import('../helpers/neon-branch')

    expect(mod.PROJECT_ID).toBe('injected-project-id')
    expect(mod.PRODUCTION_BRANCH_ID).toBe('br-injected-production')
  })

  it('falls back to the known defaults when the env var is set but empty', async () => {
    // GitHub Actions substitutes '' for a ${{ secrets.X }} reference whose secret
    // doesn't exist — nullish coalescing wouldn't catch that, so this must.
    process.env.NEON_TEST_PROJECT_ID = ''
    process.env.NEON_TEST_PRODUCTION_BRANCH_ID = '   '
    vi.resetModules()
    const mod = await import('../helpers/neon-branch')

    expect(mod.PROJECT_ID).toBe('weathered-wave-50814522')
    expect(mod.PRODUCTION_BRANCH_ID).toBe('br-square-mountain-az6f82vi')
  })
})
