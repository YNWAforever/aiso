import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const context = vi.hoisted(() => ({
  incoming: new Headers(),
  setCookie: vi.fn<(...args: unknown[]) => void>(() => { throw new Error('Cookies can only be modified in a Server Action or Route Handler.') }),
}))
vi.mock('next/headers', () => ({
  headers: async () => context.incoming,
  cookies: async () => ({ set: context.setCookie }),
}))
const sql = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ db: () => sql }))
const fetchMock = vi.fn()
const user = { id: 'fixture-user', email: 'fixture@example.test' }
const session = { id: 'fixture-session', userId: user.id, expiresAt: '2099-01-01T00:00:00Z' }
const profileRow = { id: user.id, account_id: 'fixture-account', account_id_2: 'fixture-account', plan: 'basic', status: 'active', is_admin: false }
const expiredCookie = '__Secure-neon-auth.session_token=; Max-Age=0; Path=/; Secure; HttpOnly'

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  context.setCookie.mockImplementation(() => { throw new Error('Cookies can only be modified in a Server Action or Route Handler.') })
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.fixture.invalid/neondb/auth')
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'synthetic-cookie-secret-for-rsc-read-test')
  vi.stubEnv('E2E_FIXTURE_MODE', '0')
  context.incoming = new Headers({ cookie: '__Secure-neon-auth.session_token=synthetic-not-a-real-token' })
  vi.stubGlobal('fetch', fetchMock)
  sql.mockResolvedValue([profileRow])
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('normal profile reads with installed Neon SDK in read-only Server Components', () => {
  it('returns anonymous when upstream clears an expired cookie, without an RSC cookie write escaping', async () => {
    fetchMock.mockImplementation(async () => Response.json(null, { headers: { 'set-cookie': expiredCookie } }))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).resolves.toBeNull()
    expect(context.setCookie).toHaveBeenCalled()
    expect(sql).not.toHaveBeenCalled()
  })
  it('retains a verified user when upstream refreshes its cookie without mutating read-only render cookies', async () => {
    fetchMock.mockImplementation(async () => Response.json({ session, user }, { headers: { 'set-cookie': '__Secure-neon-auth.session_token=synthetic-rotated; Path=/; Secure; HttpOnly' } }))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).resolves.toMatchObject({ id: user.id, account_id: 'fixture-account', email: user.email })
    expect(context.setCookie).toHaveBeenCalled()
    expect(sql).toHaveBeenCalledTimes(1)
  })
  it('treats an upstream unauthenticated401 as anonymous even with a clearing cookie', async () => {
    fetchMock.mockImplementation(async () => Response.json({ code: 'UNAUTHORIZED', message: 'Session expired' }, { status: 401, headers: { 'set-cookie': expiredCookie } }))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).resolves.toBeNull()
    expect(context.setCookie).toHaveBeenCalled()
    expect(sql).not.toHaveBeenCalled()
  })
  it('continues to handle the null session without an outgoing cookie', async () => {
    fetchMock.mockImplementation(async () => Response.json(null))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).resolves.toBeNull()
    expect(sql).not.toHaveBeenCalled()
  })
  it('does not use a user without a session as an authenticated identity', async () => {
    fetchMock.mockImplementation(async () => Response.json({ user }))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).resolves.toBeNull()
    expect(sql).not.toHaveBeenCalled()
  })
  it.each([
    ['empty session', {}],
    ['missing session id', { userId: user.id, expiresAt: session.expiresAt }],
    ['different user', { ...session, userId: 'other-user' }],
    ['unparseable expiry', { ...session, expiresAt: 'unknown' }],
    ['expired session', { ...session, expiresAt: '2020-01-01T00:00:00Z' }],
  ])('rejects %s even when the response includes a known user', async (_name, invalidSession) => {
    fetchMock.mockImplementation(async () => Response.json({ session: invalidSession, user }))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).resolves.toBeNull()
    expect(sql).not.toHaveBeenCalled()
  })
  it('does not turn an Auth upstream503 into a signed-out result', async () => {
    fetchMock.mockImplementation(async () => Response.json({ message: 'Auth unavailable', code: 'AUTH_UNAVAILABLE' }, { status: 503 }))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).rejects.toMatchObject({ status: 503 })
    expect(sql).not.toHaveBeenCalled()
  })
  it('does not treat a response-body transport failure as an expired session', async () => {
    const failure = new TypeError('Synthetic response stream reset')
    fetchMock.mockImplementation(async () => new Response(new ReadableStream({ start(controller) { controller.error(failure) } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).rejects.toBe(failure)
    expect(sql).not.toHaveBeenCalled()
  })
  it('preserves transport failure as an error without querying the database', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).rejects.toMatchObject({ status: 502 })
    expect(sql).not.toHaveBeenCalled()
  })
  it('leaves a due renewal for the writable browser request after an RSC profile validation', async () => {
    let refreshed = false
    const renewedCookie = '__Secure-neon-auth.session_token=synthetic-browser-renewed; Max-Age=3600; Path=/; Secure; HttpOnly'
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const due = !refreshed && url.searchParams.get('disableRefresh') !== 'true'
      if (due) refreshed = true
      return Response.json({ session, user }, { headers: due ? { 'set-cookie': renewedCookie } : {} })
    })
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).resolves.toMatchObject({ id: user.id })
    const { auth } = await import('@/lib/neon-auth')
    const response = await auth().handler().GET(new Request('http://app.fixture.invalid/api/auth/get-session?disableCookieCache=true', { headers: context.incoming }), { params: Promise.resolve({ path: ['get-session'] }) })
    expect(response.headers.get('set-cookie')).toContain('synthetic-browser-renewed')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=3600')
  })
  it('persists renewal cookies when the profile read runs in a writable Route Handler', async () => {
    context.setCookie.mockImplementation(() => {})
    fetchMock.mockImplementation(async () => Response.json({ session, user }, { headers: { 'set-cookie': '__Secure-neon-auth.session_token=synthetic-renewed; Max-Age=3600; Path=/; Secure; HttpOnly' } }))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).resolves.toMatchObject({ id: user.id })
    expect(context.setCookie).toHaveBeenCalledWith(expect.objectContaining({ name: '__Secure-neon-auth.session_token', value: 'synthetic-renewed', maxAge: 3600, httpOnly: true, secure: true }))
  })
  it('persists clearing cookies when an expired session is read in a writable handler', async () => {
    context.setCookie.mockImplementation(() => {})
    fetchMock.mockImplementation(async () => Response.json(null, { headers: { 'set-cookie': expiredCookie } }))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).resolves.toBeNull()
    expect(context.setCookie).toHaveBeenCalledWith(expect.objectContaining({ name: '__Secure-neon-auth.session_token', value: '', maxAge: 0 }))
  })
  it('does not hide an unexpected cookie persistence failure', async () => {
    const failure = new Error('Unexpected cookie persistence failure')
    context.setCookie.mockImplementation(() => { throw failure })
    fetchMock.mockImplementation(async () => Response.json({ session, user }, { headers: { 'set-cookie': expiredCookie } }))
    const { getProfile } = await import('@/lib/auth')
    await expect(getProfile()).rejects.toBe(failure)
    expect(sql).not.toHaveBeenCalled()
  })
  it('keeps cookie updates on the official Request/Response Auth handler', async () => {
    fetchMock.mockImplementation(async () => Response.json(null, { headers: { 'set-cookie': expiredCookie } }))
    const { auth } = await import('@/lib/neon-auth')
    const response = await auth().handler().GET(new Request('http://app.fixture.invalid/api/auth/get-session?disableCookieCache=true', { headers: context.incoming }), { params: Promise.resolve({ path: ['get-session'] }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(context.setCookie).not.toHaveBeenCalled()
  })
})
