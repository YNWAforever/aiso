import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeSearchConsole = vi.hoisted(() => vi.fn())
const store = vi.hoisted(() => ({
  listConnections: vi.fn(), loadConnectionSecret: vi.fn(), bindProperty: vi.fn(),
  unbindProperty: vi.fn(), loadBinding: vi.fn(), loadPanelData: vi.fn(),
}))
const listSites = vi.hoisted(() => vi.fn())
vi.mock('@/lib/integrations/search-console/guard', () => ({ authorizeSearchConsole }))
vi.mock('@/lib/integrations/search-console/store', () => store)
vi.mock('@/lib/integrations/search-console/client', () => ({ listSites }))
vi.mock('@/lib/integrations/google/vault', async o => ({ ...(await o<object>()), openToken: () => '1//r' }))
vi.mock('@/lib/integrations/google/oauth', async o => ({
  ...(await o<object>()),
  refreshAccessToken: vi.fn().mockResolvedValue('ya29.a'),
  googleOAuthConfig: () => ({ clientId: 'c', clientSecret: 's', redirectUri: 'r' }),
}))

const CONNECTION_ID = '22222222-2222-2222-2222-222222222222'

const allowed = {
  ok: true, profile: { id: 'p', account_id: 'acct', accounts: { plan: 'pro' } }, client: { id: 'c1', domain: 'example.com' },
}
const ctx = { params: Promise.resolve({ clientId: 'c1' }) }
const put = (body: unknown) => new Request('https://app.test/', { method: 'PUT', body: JSON.stringify(body) })

beforeEach(() => {
  authorizeSearchConsole.mockReset().mockResolvedValue(allowed)
  Object.values(store).forEach(fn => fn.mockReset())
  listSites.mockReset()
  store.loadConnectionSecret.mockResolvedValue({ status: 'active', sealed: { ciphertext: Buffer.from('x'), keyId: 'k' } })
})

describe('PUT bind', () => {
  it('binds an eligible property using the permission Google reports', async () => {
    listSites.mockResolvedValue([{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }])
    store.bindProperty.mockResolvedValue(true)
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const res = await PUT(put({ connectionId: CONNECTION_ID, siteUrl: 'sc-domain:example.com', permissionLevel: 'forged' }), ctx)
    expect(res.status).toBe(200)
    expect(store.bindProperty).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'acct', clientId: 'c1', permissionLevel: 'siteOwner', boundDomain: 'example.com',
    }))
  })

  it('refuses a property for another domain, with its reason', async () => {
    listSites.mockResolvedValue([{ siteUrl: 'sc-domain:other.com', permissionLevel: 'siteOwner' }])
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const res = await PUT(put({ connectionId: CONNECTION_ID, siteUrl: 'sc-domain:other.com' }), ctx)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'INELIGIBLE', reason: 'other_domain' })
    expect(store.bindProperty).not.toHaveBeenCalled()
  })

  it('refuses a property the connection cannot see', async () => {
    listSites.mockResolvedValue([])
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    expect((await PUT(put({ connectionId: CONNECTION_ID, siteUrl: 'sc-domain:example.com' }), ctx)).status).toBe(422)
  })

  it('is 404 for another account\'s connection', async () => {
    store.loadConnectionSecret.mockResolvedValue(null)
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    expect((await PUT(put({ connectionId: CONNECTION_ID, siteUrl: 'sc-domain:example.com' }), ctx)).status).toBe(404)
  })

  it('is 400 for a connectionId that is not a UUID, before touching Google or the store', async () => {
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const res = await PUT(put({ connectionId: 'not-a-uuid', siteUrl: 'sc-domain:example.com' }), ctx)
    expect(res.status).toBe(400)
    expect(listSites).not.toHaveBeenCalled()
    expect(store.loadConnectionSecret).not.toHaveBeenCalled()
  })

  it('returns the guard\'s response untouched', async () => {
    authorizeSearchConsole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    expect((await PUT(put({}), ctx)).status).toBe(403)
  })
})

describe('DELETE unbind', () => {
  it('is 404 when nothing was bound', async () => {
    store.unbindProperty.mockResolvedValue(false)
    const { DELETE } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    expect((await DELETE(new Request('https://app.test/', { method: 'DELETE' }), ctx)).status).toBe(404)
  })
})

describe('GET', () => {
  it('derives the owner state from the binding and the ledger', async () => {
    store.loadBinding.mockResolvedValue({
      connectionId: CONNECTION_ID, siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner', boundDomain: 'example.com',
      backfillPending: false, connectionStatus: 'active', currentDomain: 'example.com',
    })
    store.loadPanelData.mockResolvedValue({
      latest: { outcome: 'ok', dataThrough: '2026-09-20' }, lastGoodDataThrough: '2026-09-20', property: null, pages: [],
    })
    store.listConnections.mockResolvedValue([])
    const { GET } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const body = await (await GET(new Request('https://app.test/'), ctx)).json()
    expect(body.state).toEqual({ kind: 'synced', dataThrough: '2026-09-20' })
  })
})
