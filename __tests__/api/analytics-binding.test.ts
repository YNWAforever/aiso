import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleApiError } from '@/lib/integrations/google/oauth'
import { ANALYTICS_SCOPE, SEARCH_CONSOLE_SCOPE } from '@/lib/integrations/google/scopes'

const authorizeAnalytics = vi.hoisted(() => vi.fn())
const analyticsStore = vi.hoisted(() => ({
  bindStream: vi.fn(), updateKeyEvents: vi.fn(), unbindStream: vi.fn(),
  loadAnalyticsBinding: vi.fn(), loadAnalyticsPanel: vi.fn(),
}))
const scStore = vi.hoisted(() => ({ listConnections: vi.fn(), loadConnectionSecret: vi.fn(), markConnection: vi.fn() }))
const refreshAccessToken = vi.hoisted(() => vi.fn())
const googleOAuthConfig = vi.hoisted(() => vi.fn())
vi.mock('@/lib/integrations/analytics/guard', () => ({ authorizeAnalytics }))
vi.mock('@/lib/integrations/analytics/store', () => analyticsStore)
vi.mock('@/lib/integrations/search-console/store', () => scStore)
vi.mock('@/lib/integrations/google/vault', async o => ({ ...(await o<object>()), openToken: () => '1//r' }))
vi.mock('@/lib/integrations/google/oauth', async o => ({ ...(await o<object>()), refreshAccessToken, googleOAuthConfig }))

const ROUTE = '@/app/api/dashboard/clients/[clientId]/analytics/route'
const CONNECTION_ID = '22222222-2222-2222-2222-222222222222'
const CONNECTION_2 = '33333333-3333-3333-3333-333333333333'

const allowed = {
  ok: true, profile: { id: 'p', account_id: 'acct', accounts: { plan: 'pro' } }, client: { id: 'c1', domain: 'example.com' },
}
const ctx = { params: Promise.resolve({ clientId: 'c1' }) }
const sealed = { ciphertext: Buffer.from('x'), keyId: 'k' }
const withAnalytics = { status: 'active', sealed, scopes: [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE] }
const summary = (id: string, scopes: string[], status = 'active') =>
  ({ id, googleEmail: `${id.slice(0, 2)}@x.test`, status, scopes, createdAt: '2026-09-01T00:00:00.000Z' })

const get = (query = '') => new Request(`https://app.test/${query}`)
const put = (body: unknown) => new Request('https://app.test/', { method: 'PUT', body: JSON.stringify(body) })
const del = () => new Request('https://app.test/', { method: 'DELETE' })

const bindBody = { connectionId: CONNECTION_ID, propertyId: '123456', streamId: '789', keyEvents: ['generate_lead'] }

const webStream = (id: string, uri: string) =>
  ({ name: `properties/123456/dataStreams/${id}`, type: 'WEB_DATA_STREAM', displayName: `Stream ${id}`, webStreamData: { defaultUri: uri } })
const appStream = (id: string) =>
  ({ name: `properties/123456/dataStreams/${id}`, type: 'ANDROID_APP_DATA_STREAM', displayName: `App ${id}` })

type Api = {
  streams?: unknown[]
  keyEvents?: string[]
  summaries?: unknown[]
  status?: number
}
let fetchMock: ReturnType<typeof vi.fn>
function googleApi(api: Api = {}) {
  fetchMock = vi.fn(async (url: string) => {
    if (api.status && api.status >= 400) return new Response('{}', { status: api.status })
    if (url.includes('/accountSummaries')) return Response.json({ accountSummaries: api.summaries ?? [] })
    if (url.includes('/dataStreams')) return Response.json({ dataStreams: api.streams ?? [] })
    if (url.includes('/keyEvents')) return Response.json({ keyEvents: (api.keyEvents ?? []).map(eventName => ({ eventName })) })
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
}
const urls = () => fetchMock.mock.calls.map(c => String(c[0]))

const storedBinding = {
  connectionId: CONNECTION_ID, connectionStatus: 'active' as const, propertyId: '555', streamId: '789',
  streamHost: 'example.com', keyEvents: ['generate_lead'], eventsChosenAt: '2026-09-10T00:00:00.000Z',
  boundAt: '2026-09-10T00:00:00.000Z', backfillPending: false,
}
const emptyPanel = {
  latest: null, lastGoodDataThrough: null, lastGoodDataWithheld: false, last28: null, owner: { leadValue: null, closeRate: null },
}

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  authorizeAnalytics.mockReset().mockResolvedValue(allowed)
  Object.values(analyticsStore).forEach(fn => fn.mockReset())
  Object.values(scStore).forEach(fn => fn.mockReset())
  refreshAccessToken.mockReset().mockResolvedValue('ya29.a')
  googleOAuthConfig.mockReset().mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUri: 'r' })
  scStore.loadConnectionSecret.mockResolvedValue(withAnalytics)
  scStore.listConnections.mockResolvedValue([])
  scStore.markConnection.mockResolvedValue(undefined)
  analyticsStore.loadAnalyticsBinding.mockResolvedValue(null)
  analyticsStore.loadAnalyticsPanel.mockResolvedValue(emptyPanel)
  googleApi()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('gate', () => {
  it.each([401, 403, 404, 503])('returns the guard\'s %i untouched on every verb', async status => {
    authorizeAnalytics.mockResolvedValue({ ok: false, response: new Response(null, { status }) })
    const route = await import(ROUTE)
    expect((await route.GET(get(), ctx)).status).toBe(status)
    expect((await route.PUT(put(bindBody), ctx)).status).toBe(status)
    expect((await route.DELETE(del(), ctx)).status).toBe(status)
    expect(analyticsStore.loadAnalyticsBinding).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gates with the clientId from the path', async () => {
    const route = await import(ROUTE)
    await route.GET(get(), ctx)
    expect(authorizeAnalytics).toHaveBeenCalledWith('c1')
  })
})

describe('GET', () => {
  it('makes no Google call and no token exchange without a query', async () => {
    scStore.listConnections.mockResolvedValue([summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE])])
    const { GET } = await import(ROUTE)
    const res = await GET(get(), ctx)
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({
      state: { kind: 'unbound' }, binding: null, panel: null,
      connections: [{ id: CONNECTION_ID, email: `${CONNECTION_ID.slice(0, 2)}@x.test`, hasAnalytics: true }],
      properties: [], picker: null,
    })
  })

  it('marks a connection without the analytics scope', async () => {
    scStore.listConnections.mockResolvedValue([summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE])])
    const { GET } = await import(ROUTE)
    const body = await (await GET(get(), ctx)).json()
    expect(body.connections[0].hasAnalytics).toBe(false)
  })

  it('derives the state from the binding and passes the joined connection status', async () => {
    scStore.listConnections.mockResolvedValue([summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE], 'needs_reconnect')])
    analyticsStore.loadAnalyticsBinding.mockResolvedValue({ ...storedBinding, connectionStatus: 'needs_reconnect' })
    const { GET } = await import(ROUTE)
    const body = await (await GET(get(), ctx)).json()
    expect(body.state).toEqual({ kind: 'reconnect', dataThrough: null })
    expect(body.binding).toMatchObject({ propertyId: '555', streamHost: 'example.com' })
  })

  it('loads the panel for the stored events and binding time', async () => {
    scStore.listConnections.mockResolvedValue([summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE])])
    analyticsStore.loadAnalyticsBinding.mockResolvedValue(storedBinding)
    const { GET } = await import(ROUTE)
    const body = await (await GET(get(), ctx)).json()
    expect(analyticsStore.loadAnalyticsBinding).toHaveBeenCalledWith('acct', 'c1')
    expect(analyticsStore.loadAnalyticsPanel).toHaveBeenCalledWith('acct', 'c1', ['generate_lead'], storedBinding.boundAt)
    expect(body.panel).toEqual(emptyPanel)
    expect(body.state).toEqual({ kind: 'awaiting_first_sync' })
  })

  it('asks for the analytics grant when the bound connection lacks the scope', async () => {
    scStore.listConnections.mockResolvedValue([summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE])])
    analyticsStore.loadAnalyticsBinding.mockResolvedValue(storedBinding)
    const { GET } = await import(ROUTE)
    expect((await (await GET(get(), ctx)).json()).state).toEqual({ kind: 'grant_analytics' })
  })

  it('says rebind when the stored stream host no longer covers the brand', async () => {
    scStore.listConnections.mockResolvedValue([summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE])])
    analyticsStore.loadAnalyticsBinding.mockResolvedValue({ ...storedBinding, streamHost: 'old-brand.com' })
    const { GET } = await import(ROUTE)
    expect((await (await GET(get(), ctx)).json()).state).toMatchObject({ kind: 'rebind' })
  })

  describe('?properties=1', () => {
    it('lists properties per connection, isolating each failure', async () => {
      scStore.listConnections.mockResolvedValue([
        summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE]),
        summary(CONNECTION_2, [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE]),
      ])
      googleApi({ summaries: [{ propertySummaries: [{ property: 'properties/123456', displayName: 'Main' }] }] })
      refreshAccessToken.mockResolvedValueOnce('ya29.a').mockRejectedValueOnce(new GoogleApiError('unavailable', 0))
      const { GET } = await import(ROUTE)
      const res = await GET(get('?properties=1'), ctx)
      expect(res.status).toBe(200)
      expect((await res.json()).properties).toEqual([
        { connectionId: CONNECTION_ID, items: [{ propertyId: '123456', displayName: 'Main' }], error: null },
        { connectionId: CONNECTION_2, items: [], error: 'google_unavailable' },
      ])
    })

    it('does not call Google for a connection without the analytics scope or that is not active', async () => {
      scStore.listConnections.mockResolvedValue([
        summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE]),
        summary(CONNECTION_2, [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE], 'needs_reconnect'),
      ])
      const { GET } = await import(ROUTE)
      const body = await (await GET(get('?properties=1'), ctx)).json()
      expect(body.properties).toEqual([
        { connectionId: CONNECTION_ID, items: [], error: 'scope_missing' },
        { connectionId: CONNECTION_2, items: [], error: 'revoked' },
      ])
      expect(fetchMock).not.toHaveBeenCalled()
      expect(refreshAccessToken).not.toHaveBeenCalled()
    })

    it('reports a Google denial as access_lost for that connection only', async () => {
      scStore.listConnections.mockResolvedValue([summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE])])
      googleApi({ status: 403 })
      const { GET } = await import(ROUTE)
      const res = await GET(get('?properties=1'), ctx)
      expect(res.status).toBe(200)
      expect((await res.json()).properties).toEqual([{ connectionId: CONNECTION_ID, items: [], error: 'access_lost' }])
    })

    it('is 503 with no driver text when our own database fails, never a Google unavailable in a 200', async () => {
      scStore.listConnections.mockResolvedValue([summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE])])
      scStore.loadConnectionSecret.mockRejectedValue(
        Object.assign(new Error('connect postgresql://u:secret@host/db failed'), { name: 'NeonDbError' }),
      )
      const { GET } = await import(ROUTE)
      const res = await GET(get('?properties=1'), ctx)
      expect(res.status).toBe(503)
      expect(JSON.stringify(await res.json())).not.toContain('postgresql')
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret')
      expect(JSON.stringify(errorSpy.mock.calls)).toContain('NeonDbError')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('maps a refresh forbidden to access_lost rather than an internal error', async () => {
      scStore.listConnections.mockResolvedValue([summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE])])
      refreshAccessToken.mockRejectedValue(new GoogleApiError('forbidden', 403))
      const { GET } = await import(ROUTE)
      const res = await GET(get('?properties=1'), ctx)
      expect(res.status).toBe(200)
      expect((await res.json()).properties[0].error).toBe('access_lost')
    })
  })

  describe('picker', () => {
    beforeEach(() => {
      scStore.listConnections.mockResolvedValue([summary(CONNECTION_ID, [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE])])
    })
    const query = `?property=123456&connection=${CONNECTION_ID}`

    it('lists web streams with verdicts, leaves app streams out, and lists key events', async () => {
      googleApi({
        streams: [
          webStream('1', 'https://www.example.com'),
          webStream('2', 'https://shop.example.com'),
          appStream('3'),
        ],
        keyEvents: ['generate_lead', 'purchase'],
      })
      const { GET } = await import(ROUTE)
      const res = await GET(get(query), ctx)
      expect(res.status).toBe(200)
      expect((await res.json()).picker).toEqual({
        streams: [
          { streamId: '1', displayName: 'Stream 1', defaultUri: 'https://www.example.com', verdict: { eligible: true, host: 'www.example.com' } },
          { streamId: '2', displayName: 'Stream 2', defaultUri: 'https://shop.example.com', verdict: { eligible: false, reason: 'other_domain' } },
        ],
        keyEvents: ['generate_lead', 'purchase'],
      })
      expect(scStore.loadConnectionSecret).toHaveBeenCalledWith('acct', CONNECTION_ID)
    })

    it.each([
      ['a non-digit property', `?property=12a&connection=${CONNECTION_ID}`],
      ['a non-uuid connection', '?property=123456&connection=nope'],
      ['a property without a connection', '?property=123456'],
      ['a connection without a property', `?connection=${CONNECTION_ID}`],
    ])('is 400 for %s, before any Google call', async (_name, q) => {
      const { GET } = await import(ROUTE)
      expect((await GET(get(q), ctx)).status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(scStore.loadConnectionSecret).not.toHaveBeenCalled()
    })

    it('is 404 for a connection that is not the account\'s', async () => {
      scStore.loadConnectionSecret.mockResolvedValue(null)
      const { GET } = await import(ROUTE)
      expect((await GET(get(query), ctx)).status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('is 409 scope_missing when the connection has no analytics grant, without calling Google', async () => {
      scStore.loadConnectionSecret.mockResolvedValue({ ...withAnalytics, scopes: [SEARCH_CONSOLE_SCOPE] })
      const { GET } = await import(ROUTE)
      const res = await GET(get(query), ctx)
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'GOOGLE', reason: 'scope_missing' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('is 503 with the reason when Google is unavailable', async () => {
      googleApi({ status: 500 })
      const { GET } = await import(ROUTE)
      const res = await GET(get(query), ctx)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'GOOGLE', reason: 'unavailable' })
    })
  })

  it('is 503 with no driver text when the lookup throws', async () => {
    analyticsStore.loadAnalyticsBinding.mockRejectedValue(
      Object.assign(new Error('connect postgresql://u:secret@host/db failed'), { name: 'NeonDbError' }),
    )
    const { GET } = await import(ROUTE)
    const res = await GET(get(), ctx)
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('postgresql')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret')
    expect(JSON.stringify(errorSpy.mock.calls)).toContain('NeonDbError')
  })
})

describe('PUT validation', () => {
  it.each([
    ['a body that is not JSON', undefined],
    ['a non-uuid connectionId', { ...bindBody, connectionId: 'not-a-uuid' }],
    ['a non-digit propertyId', { ...bindBody, propertyId: '12/../3' }],
    ['a non-digit streamId', { ...bindBody, streamId: 'abc' }],
    ['a propertyId over 20 digits', { ...bindBody, propertyId: '1'.repeat(21) }],
    ['a numeric propertyId', { ...bindBody, propertyId: 123456 }],
    ['no keyEvents', { ...bindBody, keyEvents: undefined }],
    ['an empty keyEvents', { ...bindBody, keyEvents: [] }],
    ['21 keyEvents', { ...bindBody, keyEvents: Array.from({ length: 21 }, (_, i) => `e${i}`) }],
    ['a duplicated event', { ...bindBody, keyEvents: ['a', 'a'] }],
    ['an event of 41 characters', { ...bindBody, keyEvents: ['a'.repeat(41)] }],
    ['an empty event name', { ...bindBody, keyEvents: [''] }],
    ['a non-string event', { ...bindBody, keyEvents: [7] }],
    ['a partial bind (no streamId)', { connectionId: CONNECTION_ID, propertyId: '1', keyEvents: ['a'] }],
    ['a partial bind (only connectionId)', { connectionId: CONNECTION_ID, keyEvents: ['a'] }],
    ['events-only with a bad event', { keyEvents: ['a'.repeat(41)] }],
  ])('is 400 for %s, before any store or Google call', async (_name, body) => {
    const { PUT } = await import(ROUTE)
    const req = body === undefined
      ? new Request('https://app.test/', { method: 'PUT', body: '{nope' })
      : put(body)
    expect((await PUT(req, ctx)).status).toBe(400)
    expect(scStore.loadConnectionSecret).not.toHaveBeenCalled()
    expect(analyticsStore.loadAnalyticsBinding).not.toHaveBeenCalled()
    expect(analyticsStore.bindStream).not.toHaveBeenCalled()
    expect(analyticsStore.updateKeyEvents).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts 20 distinct events of 40 characters', async () => {
    const events = Array.from({ length: 20 }, (_, i) => `${'e'.repeat(38)}${String(i).padStart(2, '0')}`)
    googleApi({ streams: [webStream('789', 'https://example.com')], keyEvents: events })
    analyticsStore.bindStream.mockResolvedValue('bound')
    const { PUT } = await import(ROUTE)
    expect((await PUT(put({ ...bindBody, keyEvents: events }), ctx)).status).toBe(200)
  })
})

describe('PUT bind', () => {
  beforeEach(() => {
    googleApi({ streams: [webStream('789', 'https://www.example.com'), appStream('900')], keyEvents: ['generate_lead', 'purchase'] })
    analyticsStore.bindStream.mockResolvedValue('bound')
  })

  it('binds an eligible stream and stores the host Google reports, never one from the body', async () => {
    const { PUT } = await import(ROUTE)
    const res = await PUT(put({ ...bindBody, streamHost: 'evil.com', defaultUri: 'https://evil.com' }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ bound: true })
    expect(analyticsStore.bindStream).toHaveBeenCalledWith({
      accountId: 'acct', clientId: 'c1', connectionId: CONNECTION_ID, propertyId: '123456', streamId: '789',
      streamHost: 'www.example.com', keyEvents: ['generate_lead'],
    })
  })

  it('re-fetches the streams and key events of the named property from Google', async () => {
    const { PUT } = await import(ROUTE)
    await PUT(put(bindBody), ctx)
    expect(urls().some(u => u.includes('/properties/123456/dataStreams'))).toBe(true)
    expect(urls().some(u => u.includes('/properties/123456/keyEvents'))).toBe(true)
    expect(scStore.loadConnectionSecret).toHaveBeenCalledWith('acct', CONNECTION_ID)
  })

  it('refuses an app stream id with 422 and stores nothing', async () => {
    const { PUT } = await import(ROUTE)
    const res = await PUT(put({ ...bindBody, streamId: '900' }), ctx)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'INELIGIBLE', reason: 'not_visible' })
    expect(analyticsStore.bindStream).not.toHaveBeenCalled()
  })

  it('refuses a stream Google does not list', async () => {
    const { PUT } = await import(ROUTE)
    const res = await PUT(put({ ...bindBody, streamId: '404404' }), ctx)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'INELIGIBLE', reason: 'not_visible' })
  })

  it('refuses a stream for another site, with its reason', async () => {
    googleApi({ streams: [webStream('789', 'https://shop.example.com')], keyEvents: ['generate_lead'] })
    const { PUT } = await import(ROUTE)
    const res = await PUT(put(bindBody), ctx)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'INELIGIBLE', reason: 'other_domain' })
    expect(analyticsStore.bindStream).not.toHaveBeenCalled()
  })

  it('refuses a host longer than 253 characters with 422, never letting the CHECK throw', async () => {
    const longHost = `${Array.from({ length: 5 }, () => 'a'.repeat(60)).join('.')}.com`
    expect(longHost.length).toBeGreaterThan(253)
    authorizeAnalytics.mockResolvedValue({ ...allowed, client: { id: 'c1', domain: longHost } })
    googleApi({ streams: [webStream('789', `https://${longHost}`)], keyEvents: ['generate_lead'] })
    const { PUT } = await import(ROUTE)
    const res = await PUT(put(bindBody), ctx)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('INELIGIBLE')
    expect(analyticsStore.bindStream).not.toHaveBeenCalled()
  })

  it('refuses an event that is not currently a key event', async () => {
    const { PUT } = await import(ROUTE)
    const res = await PUT(put({ ...bindBody, keyEvents: ['generate_lead', 'made_up'] }), ctx)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'INELIGIBLE', reason: 'not_key_event' })
    expect(analyticsStore.bindStream).not.toHaveBeenCalled()
  })

  it('compares event names exactly: GA4 treats a different case as a different event', async () => {
    const { PUT } = await import(ROUTE)
    expect((await PUT(put({ ...bindBody, keyEvents: ['Generate_Lead'] }), ctx)).status).toBe(422)
  })

  it('is 404 for a connection that is not the account\'s, without calling Google', async () => {
    scStore.loadConnectionSecret.mockResolvedValue(null)
    const { PUT } = await import(ROUTE)
    expect((await PUT(put(bindBody), ctx)).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is 409 revoked when the connection needs reconnecting', async () => {
    scStore.loadConnectionSecret.mockResolvedValue({ status: 'needs_reconnect', sealed: null, scopes: [] })
    const { PUT } = await import(ROUTE)
    const res = await PUT(put(bindBody), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'GOOGLE', reason: 'revoked' })
  })

  it('is 409 scope_missing when the connection lacks the analytics grant, without calling Google', async () => {
    scStore.loadConnectionSecret.mockResolvedValue({ ...withAnalytics, scopes: [SEARCH_CONSOLE_SCOPE] })
    const { PUT } = await import(ROUTE)
    const res = await PUT(put(bindBody), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'GOOGLE', reason: 'scope_missing' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is 503 when Google is unavailable', async () => {
    googleApi({ status: 500 })
    const { PUT } = await import(ROUTE)
    const res = await PUT(put(bindBody), ctx)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'GOOGLE', reason: 'unavailable' })
  })

  it('is 503 when Google throttles', async () => {
    googleApi({ status: 429 })
    const { PUT } = await import(ROUTE)
    const res = await PUT(put(bindBody), ctx)
    expect(res.status).toBe(503)
    expect((await res.json()).reason).toBe('quota')
  })

  it('is 502 access_lost when Google denies the property', async () => {
    googleApi({ status: 403 })
    const { PUT } = await import(ROUTE)
    const res = await PUT(put(bindBody), ctx)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'GOOGLE', reason: 'access_lost' })
  })

  it('maps a refresh forbidden to access_lost, not an internal error', async () => {
    refreshAccessToken.mockRejectedValue(new GoogleApiError('forbidden', 403))
    const { PUT } = await import(ROUTE)
    const res = await PUT(put(bindBody), ctx)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'GOOGLE', reason: 'access_lost' })
  })

  it('is 503 and logs misconfigured when the OAuth config is missing', async () => {
    googleOAuthConfig.mockReturnValue(null)
    const { PUT } = await import(ROUTE)
    const res = await PUT(put(bindBody), ctx)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'GOOGLE', reason: 'config_error' })
    expect(errorSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'oauth_config_missing' }))
  })

  it('is 404 when the store finds no matching brand or connection', async () => {
    analyticsStore.bindStream.mockResolvedValue('not_found')
    const { PUT } = await import(ROUTE)
    expect((await PUT(put(bindBody), ctx)).status).toBe(404)
  })

  it('is 503 with no driver text in the body or the logs when the store throws', async () => {
    analyticsStore.bindStream.mockRejectedValue(
      Object.assign(new Error('connect postgresql://u:secret@host/db failed'), { name: 'NeonDbError' }),
    )
    const { PUT } = await import(ROUTE)
    const res = await PUT(put(bindBody), ctx)
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('postgresql')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret')
    expect(JSON.stringify(errorSpy.mock.calls)).toContain('NeonDbError')
  })

  it('is 503 when the connection lookup throws', async () => {
    scStore.loadConnectionSecret.mockRejectedValue(new Error('db'))
    const { PUT } = await import(ROUTE)
    expect((await PUT(put(bindBody), ctx)).status).toBe(503)
  })
})

describe('PUT keyEvents only', () => {
  beforeEach(() => {
    analyticsStore.loadAnalyticsBinding.mockResolvedValue(storedBinding)
    googleApi({ keyEvents: ['generate_lead', 'purchase'] })
    analyticsStore.updateKeyEvents.mockResolvedValue(true)
  })

  it('re-checks the events against the stored property and calls updateKeyEvents', async () => {
    const { PUT } = await import(ROUTE)
    const res = await PUT(put({ keyEvents: ['purchase'] }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: true })
    expect(analyticsStore.updateKeyEvents).toHaveBeenCalledWith('acct', 'c1', ['purchase'])
    expect(analyticsStore.bindStream).not.toHaveBeenCalled()
    expect(scStore.loadConnectionSecret).toHaveBeenCalledWith('acct', CONNECTION_ID)
    // The stored property, not anything from the request.
    expect(urls().every(u => u.includes('/properties/555/'))).toBe(true)
    expect(urls().some(u => u.includes('/keyEvents'))).toBe(true)
  })

  it('is 404 when nothing is bound, without calling Google', async () => {
    analyticsStore.loadAnalyticsBinding.mockResolvedValue(null)
    const { PUT } = await import(ROUTE)
    expect((await PUT(put({ keyEvents: ['purchase'] }), ctx)).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(analyticsStore.updateKeyEvents).not.toHaveBeenCalled()
  })

  it('refuses an event that is not currently a key event', async () => {
    const { PUT } = await import(ROUTE)
    const res = await PUT(put({ keyEvents: ['made_up'] }), ctx)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'INELIGIBLE', reason: 'not_key_event' })
    expect(analyticsStore.updateKeyEvents).not.toHaveBeenCalled()
  })

  it('is 404 when the binding vanished before the update', async () => {
    analyticsStore.updateKeyEvents.mockResolvedValue(false)
    const { PUT } = await import(ROUTE)
    expect((await PUT(put({ keyEvents: ['purchase'] }), ctx)).status).toBe(404)
  })

  it('is 409 revoked when the stored connection needs reconnecting', async () => {
    scStore.loadConnectionSecret.mockResolvedValue({ status: 'needs_reconnect', sealed: null, scopes: [] })
    const { PUT } = await import(ROUTE)
    const res = await PUT(put({ keyEvents: ['purchase'] }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'GOOGLE', reason: 'revoked' })
  })

  it('is 503 with no driver text when the store throws', async () => {
    analyticsStore.updateKeyEvents.mockRejectedValue(
      Object.assign(new Error('connect postgresql://u:secret@host/db failed'), { name: 'NeonDbError' }),
    )
    const { PUT } = await import(ROUTE)
    const res = await PUT(put({ keyEvents: ['purchase'] }), ctx)
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('postgresql')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret')
  })

  it('is 503 when the binding lookup throws', async () => {
    analyticsStore.loadAnalyticsBinding.mockRejectedValue(new Error('db'))
    const { PUT } = await import(ROUTE)
    expect((await PUT(put({ keyEvents: ['purchase'] }), ctx)).status).toBe(503)
  })
})

describe('DELETE', () => {
  it('unbinds', async () => {
    analyticsStore.unbindStream.mockResolvedValue(true)
    const { DELETE } = await import(ROUTE)
    const res = await DELETE(del(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ unbound: true })
    expect(analyticsStore.unbindStream).toHaveBeenCalledWith('acct', 'c1')
  })

  it('is 404 when nothing was bound', async () => {
    analyticsStore.unbindStream.mockResolvedValue(false)
    const { DELETE } = await import(ROUTE)
    expect((await DELETE(del(), ctx)).status).toBe(404)
  })

  it('is 503 with no driver text when the store throws', async () => {
    analyticsStore.unbindStream.mockRejectedValue(
      Object.assign(new Error('connect postgresql://u:secret@host/db failed'), { name: 'NeonDbError' }),
    )
    const { DELETE } = await import(ROUTE)
    const res = await DELETE(del(), ctx)
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('postgresql')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret')
  })
})
