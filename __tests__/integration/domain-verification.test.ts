import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'

vi.mock('server-only', () => ({}))
const external = vi.hoisted(() => ({ profile: vi.fn(), file: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: external.profile }))
vi.mock('@/lib/security/public-url', async original => ({
  ...await original<typeof import('@/lib/security/public-url')>(),
  createPublicUrlFetcher: () => external.file,
}))

const sql = neon(process.env.TEST_DATABASE_URL!)
beforeAll(async () => {
  const [identity] = await sql`select current_setting('neon.project_id') as project, current_setting('neon.branch_id') as branch, current_user as role`
  expect(identity.project).toBe(process.env.EXPECTED_NEON_PROJECT_ID)
  vi.stubEnv('DATABASE_URL', process.env.TEST_DATABASE_URL!)
  vi.stubEnv('EXPECTED_NEON_BRANCH_ID', identity.branch)
  vi.stubEnv('EXPECTED_DB_ROLE', identity.role)
})

/**
 * Domain-ownership verification against real Postgres (AC-03).
 *
 * The behaviour worth proving here is the binding between a proof and the
 * domain it was made for. A mock can be told that a token exists; only the
 * database can show that repointing `clients.domain` re-issues the token and
 * drops the proof, which is what stops a badge outliving the thing it
 * verified.
 */

const ACCOUNT = 'c1000000-0000-4000-8000-000000000001'
const OTHER_ACCOUNT = 'c1000000-0000-4000-8000-000000000002'
const OWNER = 'c1000000-0000-4000-8000-000000000003'
const CLIENT = 'c1000000-0000-4000-8000-000000000004'

type Row = Record<string, unknown>

const store = () => import('@/lib/domain-verification/store')

beforeEach(async () => {
  external.profile.mockResolvedValue({ id: OWNER, account_id: ACCOUNT })
  external.file.mockReset()
  await sql`delete from client_domain_verifications where account_id in (${ACCOUNT}::uuid, ${OTHER_ACCOUNT}::uuid)`
  await sql`delete from client_entities where account_id in (${ACCOUNT}::uuid, ${OTHER_ACCOUNT}::uuid)`
  await sql`delete from clients where account_id in (${ACCOUNT}::uuid, ${OTHER_ACCOUNT}::uuid)`
  await sql`delete from profiles where id = ${OWNER}::uuid`
  await sql`delete from neon_auth.user where id = ${OWNER}`
  for (const account of [ACCOUNT, OTHER_ACCOUNT]) {
    await sql`delete from accounts where id = ${account}::uuid`
    await sql`insert into accounts (id, plan, status) values (${account}::uuid, 'basic', 'active')`
  }
  await sql`
    insert into neon_auth.user (id, email, name, "emailVerified")
    values (${OWNER}, 'owner-c1@example.com', 'Owner', false)
  `
  await sql`insert into profiles (id, account_id, display_name) values (${OWNER}::uuid, ${ACCOUNT}::uuid, 'Owner')`
  await sql`
    insert into clients (id, account_id, brand_name, domain)
    values (${CLIENT}::uuid, ${ACCOUNT}::uuid, 'C1 fixture', 'https://Example.COM/pricing')
  `
})

describe('first-use service with controlled file fixture and guarded DB', () => {
  it('issues content before a probe, reuses it on read, then persists the controlled proof', async () => {
    const { readDomainVerification, checkDomainVerification } = await import('@/lib/domain-verification/service')
    const first = await (await readDomainVerification(CLIENT)).json()
    const second = await (await readDomainVerification(CLIENT)).json()
    expect(first.token).toMatch(/^aiso-site-verification=[0-9a-f]{32}$/)
    expect(second.token).toBe(first.token)
    expect(external.file).not.toHaveBeenCalled()
    // Only this synthetic file is served; this is not a claim about live ownership.
    external.file.mockImplementation(async (url: string) => {
      expect(url).toBe(`https://example.com${first.path}`)
      return new Response(first.token)
    })
    const checked = await checkDomainVerification(CLIENT)
    expect(checked.status).toBe(200)
    expect((await checked.json()).state).toBe('verified')
    expect((await (await readDomainVerification(CLIENT)).json()).token).toBe(first.token)
    const [persisted] = await sql`select token, verified_at, issued_by from client_domain_verifications where account_id = ${ACCOUNT}::uuid and client_id = ${CLIENT}::uuid`
    expect(persisted.token).toBe(first.token)
    expect(persisted.verified_at).not.toBeNull()
    expect(persisted.issued_by).toBe(OWNER)
  })
  it('returns no contents to account B', async () => {
    external.profile.mockResolvedValue({ id: OWNER, account_id: OTHER_ACCOUNT })
    const { readDomainVerification } = await import('@/lib/domain-verification/service')
    const result = await readDomainVerification(CLIENT)
    expect(result.status).toBe(404)
    expect(external.file).not.toHaveBeenCalled()
  })
})

describe('ensureVerificationToken', () => {
  it('normalises the domain it stores, so a url and a host cannot disagree', async () => {
    const { ensureVerificationToken } = await store()

    await ensureVerificationToken(ACCOUNT, CLIENT, OWNER, 'https://Example.COM/pricing')

    const rows = (await sql`
      select domain, token from client_domain_verifications where client_id = ${CLIENT}::uuid
    `) as Row[]
    expect(rows[0].domain).toBe('example.com')
    expect(rows[0].token).toMatch(/^aiso-site-verification=[0-9a-f]{32}$/)
  })

  it('keeps the same token while the domain is unchanged', async () => {
    const { ensureVerificationToken } = await store()

    const first = await ensureVerificationToken(ACCOUNT, CLIENT, OWNER, 'example.com')
    const second = await ensureVerificationToken(ACCOUNT, CLIENT, OWNER, 'example.com')

    expect(second).toBe(first)
  })

  /**
   * The reason re-issue exists. Reusing the old token would let a file still
   * sitting on the PREVIOUS site verify the new one — the owner proved
   * example.com, and nothing they did proves other.com.
   */
  it('issues a new token and drops the proof when the domain changes', async () => {
    const { ensureVerificationToken, recordVerificationResult } = await store()
    const first = await ensureVerificationToken(ACCOUNT, CLIENT, OWNER, 'example.com')
    await recordVerificationResult(ACCOUNT, CLIENT, 'example.com', 'verified')

    const second = await ensureVerificationToken(ACCOUNT, CLIENT, OWNER, 'other.com')

    expect(second).not.toBe(first)
    const rows = (await sql`
      select domain, verified_at, last_outcome from client_domain_verifications
      where client_id = ${CLIENT}::uuid
    `) as Row[]
    expect(rows[0].domain).toBe('other.com')
    expect(rows[0].verified_at).toBeNull()
    expect(rows[0].last_outcome).toBeNull()
  })

  it('writes nothing for a client that is not this account', async () => {
    const { ensureVerificationToken } = await store()

    expect(await ensureVerificationToken(OTHER_ACCOUNT, CLIENT, OWNER, 'example.com')).toBeNull()
    const rows = await sql`select 1 from client_domain_verifications where client_id = ${CLIENT}::uuid`
    expect(rows).toHaveLength(0)
  })
})

describe('recordVerificationResult', () => {
  it('sets verified_at only for the domain the row is about', async () => {
    const { ensureVerificationToken, recordVerificationResult, loadVerification } = await store()
    await ensureVerificationToken(ACCOUNT, CLIENT, OWNER, 'example.com')

    // A result computed against a domain this row is no longer about must not
    // land: the check and the row disagree, so the row keeps its own truth.
    await recordVerificationResult(ACCOUNT, CLIENT, 'other.com', 'verified')

    expect((await loadVerification(ACCOUNT, CLIENT))?.verifiedAt).toBeNull()
  })

  it('records a failure without clearing an earlier proof', async () => {
    const { ensureVerificationToken, recordVerificationResult, loadVerification } = await store()
    await ensureVerificationToken(ACCOUNT, CLIENT, OWNER, 'example.com')
    await recordVerificationResult(ACCOUNT, CLIENT, 'example.com', 'verified')

    await recordVerificationResult(ACCOUNT, CLIENT, 'example.com', 'token_absent')

    // Deciding when a site that stops answering loses its badge is a policy
    // nobody has set; inventing one here would silently revoke a real proof.
    const row = await loadVerification(ACCOUNT, CLIENT)
    expect(row?.verifiedAt).not.toBeNull()
    expect(row?.lastOutcome).toBe('token_absent')
  })
})

describe('the entity DTO', () => {
  beforeEach(async () => {
    await sql`
      insert into client_entities (client_id, account_id, display_name, aliases, revision)
      values (${CLIENT}::uuid, ${ACCOUNT}::uuid, 'C1 brand', '[]'::jsonb, 1)
      on conflict (client_id) do nothing
    `
  })

  it('reports verification from the proof rather than a constant', async () => {
    const { ensureVerificationToken, recordVerificationResult } = await store()
    const { loadEntity } = await import('@/lib/entities/store')
    expect((await loadEntity(ACCOUNT, CLIENT))?.verification).toBe('unverified')

    await ensureVerificationToken(ACCOUNT, CLIENT, OWNER, 'example.com')
    await recordVerificationResult(ACCOUNT, CLIENT, 'example.com', 'verified')

    expect((await loadEntity(ACCOUNT, CLIENT))?.verification).toBe('verified')
  })

  /**
   * The silent failure the literal could never expose: a badge that outlives
   * what it verified. Repointing the client must drop it even if nothing
   * re-issues the token first.
   */
  it('drops back to unverified when the client is repointed', async () => {
    const { ensureVerificationToken, recordVerificationResult } = await store()
    const { loadEntity } = await import('@/lib/entities/store')
    await ensureVerificationToken(ACCOUNT, CLIENT, OWNER, 'example.com')
    await recordVerificationResult(ACCOUNT, CLIENT, 'example.com', 'verified')

    await sql`update clients set domain = 'other.com' where id = ${CLIENT}::uuid`

    expect((await loadEntity(ACCOUNT, CLIENT))?.verification).toBe('unverified')
  })
})
