import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The guard these tests cover stands between `npm test` and
// `drop schema public cascade`. Everything is exercised against a mocked
// neonctl — nothing here talks to Neon.
const execFileSync = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFileSync }))

// These must agree with neon-branch.ts's defaults: createTestBranch() rejects a
// response whose project_id differs from PROJECT_ID, so a stale value here
// fails every fixture rather than testing anything. The values themselves are
// pinned by neon-branch-config.test.ts; this file only needs them to match.
const PROJECT_ID = 'weathered-wave-50814522'
const PRODUCTION_BRANCH_ID = 'br-square-mountain-az6f82vi'
const OWNER_ROLE = 'neondb_owner'
const HOST = 'ep-fake-test-aaa11111.c-2.ap-southeast-1.aws.neon.tech'
const URI = `postgresql://neondb_owner:pw@${HOST}/neondb?sslmode=require`

function createResponse(overrides: Record<string, unknown> = {}, name = 'test-branch') {
  return JSON.stringify({
    branch: {
      id: 'br-fake-child-bbb22222',
      project_id: PROJECT_ID,
      parent_id: PRODUCTION_BRANCH_ID,
      name,
      default: false,
      primary: false,
      ...overrides,
    },
    endpoints: [{ id: 'ep-fake-test-aaa11111', host: HOST, branch_id: 'br-fake-child-bbb22222' }],
  })
}

// `branches create` no longer carries a connection string once a branch has
// more than one role — every real branch does now (aeo_app + neondb_owner,
// migration 037) — so createTestBranch() makes a second, separate neonctl
// call. Real neonctl also ignores --output json for `connection-string` and
// prints the bare URI with a trailing newline; mocks match that shape.
/**
 * The neonctl argv, with any platform prefix removed.
 *
 * On Windows the helper spawns `node <neonctl>/bin/cli.js …` rather than the
 * `.cmd` shim (Node refuses to spawn .cmd without shell: true), so the real
 * subcommand starts one argument later. Everything below reads argv through
 * this, which keeps these assertions meaningful on both platforms rather than
 * silently passing on one.
 */
function neonctlArgv(args: string[]): string[] {
  return args[0]?.endsWith('cli.js') ? args.slice(1) : args
}

function mockNeonctl({
  create = createResponse(),
  connectionString = `${URI}\n`,
  del = '{}',
}: { create?: string; connectionString?: string; del?: string } = {}) {
  execFileSync.mockImplementation((_cmd: string, rawArgs: string[]) => {
    const args = neonctlArgv(rawArgs)
    if (args[0] === 'branches' && args[1] === 'create') return create
    if (args[0] === 'connection-string') return connectionString
    if (args[0] === 'branches' && args[1] === 'delete') return del
    throw new Error(`neon-branch.test.ts: unmocked neonctl invocation: ${args.join(' ')}`)
  })
}

async function load() {
  vi.resetModules()
  return import('./neon-branch')
}

// This file's fixtures assume the hardcoded PROJECT_ID/PRODUCTION_BRANCH_ID/OWNER_ROLE
// above — clear any ambient NEON_TEST_* override so a developer rehearsing the greenfield
// migration in the same shell (item 0.7/0.8) can't make these tests fail confusingly by
// having the real module diverge from these mocked fixtures.
const NEON_TEST_ENV_KEYS = ['NEON_TEST_PROJECT_ID', 'NEON_TEST_PRODUCTION_BRANCH_ID', 'NEON_TEST_OWNER_ROLE'] as const
const originalNeonTestEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  execFileSync.mockReset()
  for (const key of NEON_TEST_ENV_KEYS) {
    originalNeonTestEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of NEON_TEST_ENV_KEYS) {
    if (originalNeonTestEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalNeonTestEnv[key]
  }
})

describe('createTestBranch', () => {
  it('returns the branch when neonctl reports a child branch matching the request', async () => {
    mockNeonctl()
    const { createTestBranch } = await load()

    expect(createTestBranch('test-branch')).toEqual({
      id: 'br-fake-child-bbb22222',
      connectionUri: URI,
    })
  })

  it('trims trailing whitespace from the connection-string response', async () => {
    mockNeonctl({ connectionString: `${URI}\n` })
    const { createTestBranch } = await load()

    expect(createTestBranch('test-branch').connectionUri).toBe(URI)
  })

  it('sets an expiry so a hard crash cannot leak the branch forever', async () => {
    mockNeonctl()
    const { createTestBranch } = await load()
    createTestBranch('test-branch')

    const args = neonctlArgv(execFileSync.mock.calls[0][1] as string[])
    expect(args).toContain('--expires-at')
    const expiry = Date.parse(args[args.indexOf('--expires-at') + 1])
    expect(expiry).toBeGreaterThan(Date.now())
  })

  it('names the DDL role explicitly so a multi-role branch is not ambiguous', async () => {
    mockNeonctl()
    const { createTestBranch } = await load()
    createTestBranch('test-branch')

    const args = neonctlArgv(execFileSync.mock.calls[1][1] as string[])
    expect(args[0]).toBe('connection-string')
    expect(args).toContain('br-fake-child-bbb22222')
    expect(args).toContain('--role-name')
    expect(args[args.indexOf('--role-name') + 1]).toBe(OWNER_ROLE)
  })

  it('rejects a response naming a different branch than the one requested', async () => {
    mockNeonctl({ create: createResponse({}, 'someone-elses-branch') })
    const { createTestBranch } = await load()

    expect(() => createTestBranch('test-branch')).toThrow(/name is someone-elses-branch/)
  })

  it('rejects the default branch even if neonctl returns it', async () => {
    mockNeonctl({
      create: createResponse({ id: PRODUCTION_BRANCH_ID, default: true, primary: true, parent_id: undefined }),
    })
    const { createTestBranch } = await load()

    expect(() => createTestBranch('test-branch')).toThrow(/default branch/)
  })

  it('rejects a connection uri that belongs to no endpoint of the branch', async () => {
    // The exact hazard scripts/neon documents: connection-string returning a
    // different branch's (e.g. the parent's) endpoint.
    mockNeonctl({ connectionString: 'postgresql://u:p@ep-somewhere-else.neon.tech/neondb' })
    const { createTestBranch } = await load()

    expect(() => createTestBranch('test-branch')).toThrow(/does not match any endpoint/)
  })

  it('does not register an identity-mismatched branch for cleanup', async () => {
    mockNeonctl({ create: createResponse({}, 'someone-elses-branch') })
    const { createTestBranch, createdBranchIds } = await load()

    expect(() => createTestBranch('test-branch')).toThrow()
    expect(createdBranchIds()).toEqual([])
  })

  it('fails loudly when the JSON shape no longer carries a branch id', async () => {
    execFileSync.mockReturnValue(JSON.stringify({ data: { branch: { id: 'br-x-y' } } }))
    const { createTestBranch } = await load()

    expect(() => createTestBranch('test-branch')).toThrow(/no usable branch id/)
  })
})

describe('assertDisposableTestBranch', () => {
  it('accepts the branch this process just created', async () => {
    mockNeonctl()
    const { createTestBranch, assertDisposableTestBranch } = await load()
    const branch = createTestBranch('test-branch')

    expect(() => assertDisposableTestBranch(branch)).not.toThrow()
  })

  it('rejects a branch this process did not create', async () => {
    const { assertDisposableTestBranch } = await load()

    expect(() =>
      assertDisposableTestBranch({ id: 'br-fake-child-bbb22222', connectionUri: URI }),
    ).toThrow(/this process did not create it/)
  })

  it('rejects the production branch id', async () => {
    const { assertDisposableTestBranch } = await load()

    expect(() =>
      assertDisposableTestBranch({ id: PRODUCTION_BRANCH_ID, connectionUri: URI }),
    ).toThrow(/did not create it/)
  })

  it('rejects a real branch id carrying a swapped-in connection uri', async () => {
    mockNeonctl()
    const { createTestBranch, assertDisposableTestBranch } = await load()
    const branch = createTestBranch('test-branch')

    expect(() =>
      assertDisposableTestBranch({
        id: branch.id,
        connectionUri: 'postgresql://u:p@ep-production.neon.tech/neondb',
      }),
    ).toThrow(/not the one neonctl returned/)
  })

  it('rejects a branch whose host is the production DATABASE_URL host', async () => {
    const prodHost = 'ep-prod-endpoint-zzz99999.c-2.ap-southeast-1.aws.neon.tech'
    vi.stubEnv('DATABASE_URL', `postgresql://u:p@${prodHost.replace('.c-2', '-pooler.c-2')}/neondb`)
    const body = JSON.parse(createResponse())
    body.endpoints[0].host = prodHost
    mockNeonctl({
      create: JSON.stringify(body),
      connectionString: `postgresql://u:p@${prodHost}/neondb`,
    })

    const { createTestBranch, assertDisposableTestBranch } = await load()
    const branch = createTestBranch('test-branch')

    expect(() => assertDisposableTestBranch(branch)).toThrow(/production DATABASE_URL host/)
    vi.unstubAllEnvs()
  })
})

describe('deleteTestBranch', () => {
  it('drops the branch from the created registry once neonctl succeeds', async () => {
    mockNeonctl()
    const { createTestBranch, deleteTestBranch, createdBranchIds } = await load()
    const branch = createTestBranch('test-branch')

    execFileSync.mockReturnValue('{}')
    deleteTestBranch(branch.id)
    expect(createdBranchIds()).toEqual([])
  })

  it('keeps the branch registered when neonctl fails, so cleanup can retry', async () => {
    mockNeonctl()
    const { createTestBranch, deleteTestBranch, createdBranchIds } = await load()
    const branch = createTestBranch('test-branch')

    execFileSync.mockImplementation(() => {
      throw new Error('Command failed: neonctl branches delete')
    })
    expect(() => deleteTestBranch(branch.id)).toThrow(/neonctl branches delete failed/)
    expect(createdBranchIds()).toEqual([branch.id])
  })
})

describe('cleanup cannot bypass create identity guards',()=>{
  it.each([{id:PRODUCTION_BRANCH_ID},{default:true},{primary:true},{project_id:'wrong-project'},{parent_id:null},{name:'someone-elses-branch'}])('does not register an unproven branch %j',async overrides=>{
    mockNeonctl({create:createResponse(overrides)})
    const {createTestBranch,createdBranchIds,deleteTestBranch}=await load()
    expect(()=>createTestBranch('test-branch')).toThrow()
    for(const id of createdBranchIds()) deleteTestBranch(id)
    expect(createdBranchIds()).toEqual([])
    const invoked=execFileSync.mock.calls.map(call=>neonctlArgv(call[1]))
    expect(invoked.some(args=>args[0]==='connection-string')).toBe(false)
    expect(invoked.some(args=>args[0]==='branches'&&args[1]==='delete')).toBe(false)
  })
  it.each([PRODUCTION_BRANCH_ID,'br-unregistered-child','not-a-branch'])('refuses direct deletion of %s',async id=>{
    mockNeonctl()
    const {deleteTestBranch}=await load()
    expect(()=>deleteTestBranch(id)).toThrow(/Refusing/)
    expect(execFileSync).not.toHaveBeenCalled()
  })
  it('retains a validated child for cleanup if connection retrieval fails',async()=>{
    mockNeonctl()
    const original=execFileSync.getMockImplementation()!
    execFileSync.mockImplementation((...args)=>{
      if(neonctlArgv(args[1])[0]==='connection-string')throw new Error('synthetic lookup failed')
      return original(...args)
    })
    const {createTestBranch,createdBranchIds,deleteTestBranch}=await load()
    expect(()=>createTestBranch('test-branch')).toThrow()
    expect(createdBranchIds()).toEqual(['br-fake-child-bbb22222'])
    deleteTestBranch('br-fake-child-bbb22222')
    expect(createdBranchIds()).toEqual([])
  })
})
