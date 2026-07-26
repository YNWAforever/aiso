import { describe, it, expect, vi, beforeEach } from 'vitest'

// The guard these tests cover stands between `npm test` and
// `drop schema public cascade`. Everything is exercised against a mocked
// neonctl — nothing here talks to Neon.
const execFileSync = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFileSync }))

const PROJECT_ID = 'red-firefly-93523049'
const PRODUCTION_BRANCH_ID = 'br-rough-butterfly-aojtgi92'
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
    connection_uris: [{ connection_uri: URI }],
  })
}

async function load() {
  vi.resetModules()
  return import('./neon-branch')
}

beforeEach(() => {
  execFileSync.mockReset()
})

describe('createTestBranch', () => {
  it('returns the branch when neonctl reports a child branch matching the request', async () => {
    execFileSync.mockReturnValue(createResponse())
    const { createTestBranch } = await load()

    expect(createTestBranch('test-branch')).toEqual({
      id: 'br-fake-child-bbb22222',
      connectionUri: URI,
    })
  })

  it('sets an expiry so a hard crash cannot leak the branch forever', async () => {
    execFileSync.mockReturnValue(createResponse())
    const { createTestBranch } = await load()
    createTestBranch('test-branch')

    const args = execFileSync.mock.calls[0][1] as string[]
    expect(args).toContain('--expires-at')
    const expiry = Date.parse(args[args.indexOf('--expires-at') + 1])
    expect(expiry).toBeGreaterThan(Date.now())
  })

  it('rejects a response naming a different branch than the one requested', async () => {
    execFileSync.mockReturnValue(createResponse({}, 'someone-elses-branch'))
    const { createTestBranch } = await load()

    expect(() => createTestBranch('test-branch')).toThrow(/name is someone-elses-branch/)
  })

  it('rejects the default branch even if neonctl returns it', async () => {
    execFileSync.mockReturnValue(
      createResponse({ id: PRODUCTION_BRANCH_ID, default: true, primary: true, parent_id: undefined }),
    )
    const { createTestBranch } = await load()

    expect(() => createTestBranch('test-branch')).toThrow(/default branch/)
  })

  it('rejects a connection uri that belongs to no endpoint of the branch', async () => {
    const body = JSON.parse(createResponse())
    body.connection_uris[0].connection_uri = 'postgresql://u:p@ep-somewhere-else.neon.tech/neondb'
    execFileSync.mockReturnValue(JSON.stringify(body))
    const { createTestBranch } = await load()

    expect(() => createTestBranch('test-branch')).toThrow(/does not match any endpoint/)
  })

  it('records a rejected branch so the caller can still delete it', async () => {
    execFileSync.mockReturnValue(createResponse({}, 'someone-elses-branch'))
    const { createTestBranch, createdBranchIds } = await load()

    expect(() => createTestBranch('test-branch')).toThrow()
    expect(createdBranchIds()).toEqual(['br-fake-child-bbb22222'])
  })

  it('fails loudly when the JSON shape no longer carries a branch id', async () => {
    execFileSync.mockReturnValue(JSON.stringify({ data: { branch: { id: 'br-x-y' } } }))
    const { createTestBranch } = await load()

    expect(() => createTestBranch('test-branch')).toThrow(/no usable branch id/)
  })
})

describe('assertDisposableTestBranch', () => {
  it('accepts the branch this process just created', async () => {
    execFileSync.mockReturnValue(createResponse())
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
    execFileSync.mockReturnValue(createResponse())
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
    body.connection_uris[0].connection_uri = `postgresql://u:p@${prodHost}/neondb`
    execFileSync.mockReturnValue(JSON.stringify(body))

    const { createTestBranch, assertDisposableTestBranch } = await load()
    const branch = createTestBranch('test-branch')

    expect(() => assertDisposableTestBranch(branch)).toThrow(/production DATABASE_URL host/)
    vi.unstubAllEnvs()
  })
})

describe('deleteTestBranch', () => {
  it('drops the branch from the created registry once neonctl succeeds', async () => {
    execFileSync.mockReturnValue(createResponse())
    const { createTestBranch, deleteTestBranch, createdBranchIds } = await load()
    const branch = createTestBranch('test-branch')

    execFileSync.mockReturnValue('{}')
    deleteTestBranch(branch.id)
    expect(createdBranchIds()).toEqual([])
  })

  it('keeps the branch registered when neonctl fails, so cleanup can retry', async () => {
    execFileSync.mockReturnValue(createResponse())
    const { createTestBranch, deleteTestBranch, createdBranchIds } = await load()
    const branch = createTestBranch('test-branch')

    execFileSync.mockImplementation(() => {
      throw new Error('Command failed: neonctl branches delete')
    })
    expect(() => deleteTestBranch(branch.id)).toThrow(/neonctl branches delete failed/)
    expect(createdBranchIds()).toEqual([branch.id])
  })
})
