import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleApiError } from '@/lib/integrations/google/oauth'

const authorizeSearchConsole = vi.hoisted(() => vi.fn())
const store = vi.hoisted(() => ({
  listConnections: vi.fn(), loadConnectionSecret: vi.fn(), bindProperty: vi.fn(),
  unbindProperty: vi.fn(), loadBinding: vi.fn(), loadPanelData: vi.fn(),
}))
const listSites = vi.hoisted(() => vi.fn())
const refreshAccessToken = vi.hoisted(() => vi.fn())
const googleOAuthConfig = vi.hoisted(() => vi.fn())
vi.mock('@/lib/integrations/search-console/guard', () => ({ authorizeSearchConsole }))
vi.mock('@/lib/integrations/search-console/store', () => store)
vi.mock('@/lib/integrations/search-console/client', () => ({ listSites }))
vi.mock('@/lib/integrations/google/vault', async o => ({ ...(await o<object>()), openToken: () => '1//r' }))
vi.mock('@/lib/integrations/google/oauth', async o => ({ ...(await o<object>()), refreshAccessToken, googleOAuthConfig }))

const CONNECTION_ID = '22222222-2222-2222-2222-222222222222'
const CONNECTION_ID_2 = '33333333-3333-3333-3333-333333333333'

const allowed = {
  ok: true, profile: { id: 'p', account_id: 'acct', accounts: { plan: 'pro' } }, client: { id: 'c1', domain: 'example.com' },
}
const ctx = { params: Promise.resolve({ clientId: 'c1' }) }
const put = (body: unknown) => new Request('https://app.test/', { method: 'PUT', body: JSON.stringify(body) })
const emptyPanel = { latest: null, lastGoodDataThrough: null, property: null, pages: [] }

beforeEach(() => {
  authorizeSearchConsole.mockReset().mockResolvedValue(allowed)
  Object.values(store).forEach(fn => fn.mockReset())
  listSites.mockReset()
  refreshAccessToken.mockReset().mockResolvedValue('ya29.a')
  googleOAuthConfig.mockReset().mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUri: 'r' })
  store.loadConnectionSecret.mockResolvedValue({ status: 'active', sealed: { ciphertext: Buffer.from('x'), keyId: 'k' } })
  store.loadBinding.mockResolvedValue(null)
  store.loadPanelData.mockResolvedValue(emptyPanel)
  store.listConnections.mockResolvedValue([])
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

  it('is 409 when the connection needs reconnecting', async () => {
    store.loadConnectionSecret.mockResolvedValue({ status: 'needs_reconnect', sealed: null })
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const res = await PUT(put({ connectionId: CONNECTION_ID, siteUrl: 'sc-domain:example.com' }), ctx)
    expect(res.status).toBe(409)
  })

  it('is 503 when Google is unavailable', async () => {
    refreshAccessToken.mockRejectedValue(new GoogleApiError('unavailable', 0))
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const res = await PUT(put({ connectionId: CONNECTION_ID, siteUrl: 'sc-domain:example.com' }), ctx)
    expect(res.status).toBe(503)
  })

  it('is 503 when the OAuth config is missing, logged as misconfigured', async () => {
    googleOAuthConfig.mockReturnValue(null)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
      const res = await PUT(put({ connectionId: CONNECTION_ID, siteUrl: 'sc-domain:example.com' }), ctx)
      expect(res.status).toBe(503)
      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        { kind: 'misconfigured', status: 0, code: 'oauth_config_missing' },
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('is 404 when bindProperty finds no matching row', async () => {
    listSites.mockResolvedValue([{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }])
    store.bindProperty.mockResolvedValue(false)
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const res = await PUT(put({ connectionId: CONNECTION_ID, siteUrl: 'sc-domain:example.com' }), ctx)
    expect(res.status).toBe(404)
  })

  it('is 503 when bindProperty throws', async () => {
    listSites.mockResolvedValue([{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }])
    store.bindProperty.mockRejectedValue(new Error('db'))
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const res = await PUT(put({ connectionId: CONNECTION_ID, siteUrl: 'sc-domain:example.com' }), ctx)
    expect(res.status).toBe(503)
  })

  it('calls loadConnectionSecret with the account and the connection id', async () => {
    listSites.mockResolvedValue([{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }])
    store.bindProperty.mockResolvedValue(true)
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    await PUT(put({ connectionId: CONNECTION_ID, siteUrl: 'sc-domain:example.com' }), ctx)
    expect(store.loadConnectionSecret).toHaveBeenCalledWith('acct', CONNECTION_ID)
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
    const { GET } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const body = await (await GET(new Request('https://app.test/'), ctx)).json()
    expect(body.state).toEqual({ kind: 'synced', dataThrough: '2026-09-20' })
  })
})

describe('GET without ?properties=1', () => {
  it('never calls Google, or even lists connections, and returns an empty properties list', async () => {
    const { GET } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const res = await GET(new Request('https://app.test/'), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.properties).toEqual([])
    expect(store.listConnections).not.toHaveBeenCalled()
    expect(store.loadConnectionSecret).not.toHaveBeenCalled()
    expect(listSites).not.toHaveBeenCalled()
  })
})

describe('GET ?properties=1', () => {
  it('lists sites per connection, isolating one Google failure from the other', async () => {
    store.listConnections.mockResolvedValue([
      { id: CONNECTION_ID, googleEmail: 'a@x.com', status: 'active', scopes: [], createdAt: '2026-01-01' },
      { id: CONNECTION_ID_2, googleEmail: 'b@x.com', status: 'active', scopes: [], createdAt: '2026-01-01' },
    ])
    listSites
      .mockRejectedValueOnce(new GoogleApiError('quota', 429))
      .mockResolvedValueOnce([{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }])
    const { GET } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const res = await GET(new Request('https://app.test/?properties=1'), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.properties).toEqual([
      { connectionId: CONNECTION_ID, googleEmail: 'a@x.com', error: 'quota', sites: [] },
      {
        connectionId: CONNECTION_ID_2, googleEmail: 'b@x.com', error: null,
        sites: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner', verdict: { eligible: true } }],
      },
    ])
  })

  it('logs a misconfigured Google failure with kind, status and code only', async () => {
    store.listConnections.mockResolvedValue([
      { id: CONNECTION_ID, googleEmail: 'a@x.com', status: 'active', scopes: [], createdAt: '2026-01-01' },
    ])
    listSites.mockRejectedValue(new GoogleApiError('misconfigured', 403, 'SERVICE_DISABLED'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { GET } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
      await GET(new Request('https://app.test/?properties=1'), ctx)
      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        { kind: 'misconfigured', status: 403, code: 'SERVICE_DISABLED' },
      )
    } finally {
      spy.mockRestore()
    }
  })
})

describe('GET logging', () => {
  it('never logs a thrown error\'s message or object, only its name — and never a token', async () => {
    store.loadBinding.mockRejectedValue(new Error('secret ya29.abcdefghij'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { GET } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
      const res = await GET(new Request('https://app.test/'), ctx)
      expect(res.status).toBe(503)
      expect(spy).toHaveBeenCalledWith(expect.any(String), { name: 'Error' })
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(JSON.stringify(arg)).not.toContain('ya29')
          expect(JSON.stringify(arg)).not.toContain('secret')
        }
      }
    } finally {
      spy.mockRestore()
    }
  })
})
