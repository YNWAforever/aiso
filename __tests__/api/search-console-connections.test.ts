import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProfile = vi.hoisted(() => vi.fn())
const store = vi.hoisted(() => ({ listConnections: vi.fn(), loadConnectionSecret: vi.fn(), revokeConnectionRow: vi.fn() }))
const revokeToken = vi.hoisted(() => vi.fn())
const openToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/integrations/search-console/store', () => store)
vi.mock('@/lib/integrations/google/oauth', async o => ({ ...(await o<object>()), revokeToken }))
vi.mock('@/lib/integrations/google/vault', async o => ({ ...(await o<object>()), openToken }))

const profile = { id: 'p', account_id: 'acct', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }
const sealed = { ciphertext: Buffer.from('x'), keyId: 'k' }
const GID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  process.env.FEATURE_SEARCH_CONSOLE = '1'
  getProfile.mockReset().mockResolvedValue(profile)
  Object.values(store).forEach(fn => fn.mockReset())
  revokeToken.mockReset()
  openToken.mockReset().mockReturnValue('1//r')
})

describe('GET', () => {
  it('lists only the session account\'s connections', async () => {
    store.listConnections.mockResolvedValue([{ id: 'g', googleEmail: 'o@e.com', status: 'active', scopes: [], createdAt: 'x' }])
    const { GET } = await import('@/app/api/account/integrations/google/route')
    const res = await GET()
    expect(store.listConnections).toHaveBeenCalledWith('acct')
    expect((await res.json()).connections).toHaveLength(1)
  })

  it('is 503 when the read fails', async () => {
    store.listConnections.mockRejectedValue(new Error('db'))
    const { GET } = await import('@/app/api/account/integrations/google/route')
    expect((await GET()).status).toBe(503)
  })
})

describe('DELETE', () => {
  const del = async (id: string | null) => {
    const { DELETE } = await import('@/app/api/account/integrations/google/route')
    return DELETE(new Request(`https://app.test/api/account/integrations/google${id ? `?id=${id}` : ''}`, { method: 'DELETE' }))
  }

  it('is 400 without an id', async () => {
    expect((await del(null)).status).toBe(400)
  })

  it('is 400 for a malformed id, and never reaches the store', async () => {
    expect((await del('not-a-uuid')).status).toBe(400)
    expect(store.loadConnectionSecret).not.toHaveBeenCalled()
  })

  it('is 404 for a connection that is not the account\'s', async () => {
    store.loadConnectionSecret.mockResolvedValue(null)
    expect((await del(GID)).status).toBe(404)
    expect(store.revokeConnectionRow).not.toHaveBeenCalled()
  })

  it('deletes locally even when Google refuses the revoke, and says so', async () => {
    store.loadConnectionSecret.mockResolvedValue({ status: 'active', sealed })
    revokeToken.mockResolvedValue(false)
    store.revokeConnectionRow.mockResolvedValue(true)
    const res = await del(GID)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revoked: true, googleRevoked: false })
    expect(store.revokeConnectionRow).toHaveBeenCalledWith('acct', GID)
  })

  it('still deletes locally when the token cannot be decrypted', async () => {
    store.loadConnectionSecret.mockResolvedValue({ status: 'active', sealed })
    openToken.mockImplementation(() => { throw new Error('vault') })
    store.revokeConnectionRow.mockResolvedValue(true)
    expect(await (await del(GID)).json()).toEqual({ revoked: true, googleRevoked: false })
  })

  it('is 503 when the local delete fails', async () => {
    store.loadConnectionSecret.mockResolvedValue({ status: 'revoked', sealed: null })
    store.revokeConnectionRow.mockRejectedValue(new Error('db'))
    expect((await del(GID)).status).toBe(503)
  })

  it('re-deleting an already-revoked connection is a no-op 200, and never calls Google', async () => {
    store.loadConnectionSecret.mockResolvedValue({ status: 'revoked', sealed: null })
    store.revokeConnectionRow.mockResolvedValue(true)
    const res = await del(GID)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revoked: true, googleRevoked: false })
    expect(revokeToken).not.toHaveBeenCalled()
  })
})
