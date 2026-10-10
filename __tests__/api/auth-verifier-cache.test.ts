import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const secret = 'synthetic-session-cache-secret-at-least-32-chars'
const authBase = 'https://synthetic-auth.example.test/auth'
const tokenCookie = '__Secure-neon-auth.session_token'
const cacheCookie = '__Secure-neon-auth.local.session_data'
const verifierParam = 'neon_auth_session_verifier'

function session(userId: string, token: string) {
  const now = new Date().toISOString()
  return {
    session: { id: `session-${userId}`, userId, token, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    user: { id: userId, email: `${userId}@example.test`, name: userId, emailVerified: true, createdAt: now, updatedAt: now },
  }
}

const oldSession = () => session('old-unmapped-A', 'synthetic-old-A')
const newSession = () => session('new-mapped-B', 'synthetic-new-B')
function oldCookies(withCache = true) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ ...oldSession(), exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url')
  const signed = `${header}.${payload}`
  const jwt = `${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`
  return `${tokenCookie}=synthetic-old-A${withCache ? `; ${cacheCookie}=${jwt}` : ''}`
}

let upstreamRequests: Request[]
let failureStatus: number | undefined
beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NEON_AUTH_BASE_URL', authBase)
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', secret)
  upstreamRequests = []
  failureStatus = undefined
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== new URL(authBase).origin || url.pathname !== '/auth/get-session') throw new Error('Unexpected upstream request; real network prohibited')
    upstreamRequests.push(request)
    if (url.searchParams.has(verifierParam)) {
      if (failureStatus) return Response.json({ code: 'SYNTHETIC_UPSTREAM_FAILURE' }, { status: failureStatus })
      if (url.searchParams.get(verifierParam) !== 'synthetic-fresh-verifier') return Response.json({ code: 'INVALID_SESSION_VERIFIER' }, { status: 401 })
      return Response.json(newSession(), { headers: { 'set-cookie': `${tokenCookie}=synthetic-new-B; Path=/; HttpOnly; Secure; SameSite=Lax` } })
    }
    return Response.json(request.headers.get('cookie')?.includes('synthetic-new-B') ? newSession() : oldSession())
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function getSession(query: string, withCache = true) {
  const { GET } = await import('@/app/api/auth/[...path]/route')
  return GET(new Request(`http://localhost/api/auth/get-session${query}`, { headers: { cookie: oldCookies(withCache), 'x-test-preserved': 'yes' } }), { params: Promise.resolve({ path: ['get-session'] }) })
}

describe('real Neon SDK verifier exchange with an existing identity cookie', () => {
  it('retains the ordinary session cache fast path', async () => {
    const response = await getSession('')
    expect(response.status).toBe(200)
    expect((await response.json()).user.id).toBe('old-unmapped-A')
    expect(upstreamRequests).toHaveLength(0)
  })

  it.each([
    ['valid old cache', true, ''],
    ['old token without local cache', false, ''],
    ['explicit cache opt-in cannot hide the verifier', true, '&disableCookieCache=false'],
  ] as const)('exchanges a fresh verifier before returning %s', async (_name, withCache, suffix) => {
    const response = await getSession(`?${verifierParam}=synthetic-fresh-verifier&next=%2Fzh-HK%2Fdashboard${suffix}`, withCache)
    expect(response.status).toBe(200)
    expect((await response.json()).user.id).toBe('new-mapped-B')
    expect(response.headers.getSetCookie().some(value => value.startsWith(`${tokenCookie}=synthetic-new-B;`))).toBe(true)
    const exchanges = upstreamRequests.filter(request => new URL(request.url).searchParams.has(verifierParam))
    expect(exchanges).toHaveLength(1)
    expect(new URL(exchanges[0].url).searchParams.get('next')).toBe('/zh-HK/dashboard')
    expect(upstreamRequests.every(request => new URL(request.url).searchParams.has(verifierParam) || request.headers.get('cookie')?.includes('synthetic-new-B'))).toBe(true)
  })

  it.each(['synthetic-invalid-verifier', ''])('rejects an invalid verifier instead of returning the old cached user (%s)', async verifier => {
    const response = await getSession(`?${verifierParam}=${verifier}`)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'INVALID_SESSION_VERIFIER' })
    expect(upstreamRequests).toHaveLength(1)
  })

  it('preserves upstream failure instead of reporting old cached success', async () => {
    failureStatus = 503
    const response = await getSession(`?${verifierParam}=synthetic-fresh-verifier`)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'SYNTHETIC_UPSTREAM_FAILURE' })
  })
})