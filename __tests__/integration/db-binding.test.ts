import { neon } from '@neondatabase/serverless'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_ID } from '../helpers/neon-branch'

/**
 * The binding guard against a real Neon branch.
 *
 * The unit suites prove the decision (__tests__/security/db-binding.test.ts)
 * and the Proxy (__tests__/security/db-guard.test.ts) with the transport
 * stubbed. What neither can prove is the premise the whole guard rests on:
 * that `current_setting('neon.project_id', true)` actually answers on a live
 * Neon connection. That is the one assertion here that needs a database.
 *
 * globalSetup provisions an ephemeral branch inside PROJECT_ID and arms the
 * guard with that project id, deliberately leaving EXPECTED_NEON_BRANCH_ID
 * unset — the branch id differs every run, which is precisely the case the
 * optional-when-unset rule exists for.
 */

const ENV_KEYS = [
  'DATABASE_URL',
  'EXPECTED_NEON_PROJECT_ID',
  'EXPECTED_NEON_BRANCH_ID',
  'EXPECTED_DB_ROLE',
  'EXPECTED_DB_NAME',
  'FORBIDDEN_NEON_PROJECT_IDS',
  'FORBIDDEN_NEON_BRANCH_IDS',
  'FORBIDDEN_DB_HOSTS',
] as const

let saved: Record<string, string | undefined>
let branchUrl: string

beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is not set — globalSetup did not provision a branch')
  }
  branchUrl = process.env.TEST_DATABASE_URL
})

beforeEach(() => {
  vi.resetModules()
  saved = {}
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  // db() reads DATABASE_URL; point it at the ephemeral branch rather than at
  // whatever this machine's real DATABASE_URL is.
  process.env.DATABASE_URL = branchUrl
  process.env.EXPECTED_NEON_PROJECT_ID = PROJECT_ID
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

async function loadDb() {
  return (await import('@/lib/db')).db
}

describe('the Neon identity GUCs answer on a live connection', () => {
  it('reports this branch inside the harness project', async () => {
    const sql = neon(branchUrl)
    const [row] = await sql`
      select current_setting('neon.project_id', true) as project_id,
             current_setting('neon.branch_id', true)  as branch_id,
             current_user                             as role,
             current_database()                       as database
    `
    // Not merely non-null: the value has to be the project the harness created
    // the branch in, or the guard's central comparison means nothing.
    expect(row.project_id).toBe(PROJECT_ID)
    expect(row.branch_id).toMatch(/^br-/)
    expect(row.database).toBe('neondb')
  })
})

describe('db() against the harness branch', () => {
  it('connects when the expectation matches', async () => {
    const sql = (await loadDb())()
    const [row] = await sql`select 1 as ok`
    expect(row.ok).toBe(1)
  })

  it('still connects with EXPECTED_NEON_BRANCH_ID unset, as integration runs need', async () => {
    expect(process.env.EXPECTED_NEON_BRANCH_ID).toBeUndefined()
    const sql = (await loadDb())()
    await expect(sql`select 1 as ok`).resolves.toHaveLength(1)
  })

  it('refuses a forged project expectation, naming the project field', async () => {
    process.env.EXPECTED_NEON_PROJECT_ID = 'not-the-project-this-branch-is-in'
    const sql = (await loadDb())()

    await expect(sql`select 1 as ok`).rejects.toThrow(/Neon project/)
    await expect(sql`select 1 as ok`).rejects.toThrow(/not-the-project-this-branch-is-in/)
    await expect(sql`select 1 as ok`).rejects.toThrow(new RegExp(PROJECT_ID))
  })

  it('refuses when the branch expectation is set and wrong', async () => {
    process.env.EXPECTED_NEON_BRANCH_ID = 'br-not-this-branch'
    const sql = (await loadDb())()
    await expect(sql`select 1 as ok`).rejects.toThrow(/Neon branch/)
  })

  it('refuses the wrong role — the 2026-09-05 incident, caught', async () => {
    // The harness connects as the owner, so pinning the application role is
    // exactly the mismatch that went unnoticed for three days.
    process.env.EXPECTED_DB_ROLE = 'aeo_app'
    const sql = (await loadDb())()
    await expect(sql`select 1 as ok`).rejects.toThrow(/database role/)
  })

  it('refuses this branch when its host is blocklisted', async () => {
    process.env.FORBIDDEN_DB_HOSTS = new URL(branchUrl).hostname
    const sql = (await loadDb())()
    await expect(sql`select 1 as ok`).rejects.toThrow(/forbidden/i)
  })

  it('refuses to connect at all with no project expectation', async () => {
    delete process.env.EXPECTED_NEON_PROJECT_ID
    const sql = (await loadDb())()
    await expect(sql`select 1 as ok`).rejects.toThrow(/EXPECTED_NEON_PROJECT_ID/)
  })

  it('never puts the branch password in a rejection message', async () => {
    process.env.EXPECTED_NEON_PROJECT_ID = 'not-the-project-this-branch-is-in'
    const password = new URL(branchUrl).password
    expect(password.length).toBeGreaterThan(0)

    const sql = (await loadDb())()
    await expect(sql`select 1 as ok`).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(password) as unknown as string,
      }),
    )
  })
})
