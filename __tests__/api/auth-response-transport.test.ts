import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nativeFetch = globalThis.fetch
const authBase = 'https://synthetic-auth.example.test/auth'
const secret = 'synthetic-transport-secret-at-least-32-chars'
const fixtureCreatedAt = new Date().toISOString()
const payload = { session: { id: 'synthetic-session', userId: 'fixture-B', token: 'synthetic-only', createdAt: fixtureCreatedAt, updatedAt: fixtureCreatedAt, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, user: { id: 'fixture-B', email: 'fixture@example.test', name: 'fixture-B', emailVerified: true, createdAt: fixtureCreatedAt, updatedAt: fixtureCreatedAt } }
let encoding: 'gzip' | 'br' | null
let status: number
beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NEON_AUTH_BASE_URL', authBase)
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', secret)
  encoding = null
  status = 200
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== new URL(authBase).origin || url.pathname !== '/auth/get-session') throw new Error('Unexpected upstream; real provider network prohibited')
    const body = status === 200 ? JSON.stringify(payload) : JSON.stringify({ code: 'SYNTHETIC_FAILURE' })
    const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'private, no-store' })
    if (status === 200) headers.append('set-cookie', '__Secure-neon-auth.session_token=synthetic-only; Path=/; HttpOnly; Secure')
    if (encoding) {
      // Node fetch has already decoded this body but retains upstream metadata.
      const compressed = encoding === 'gzip' ? gzipSync(body) : brotliCompressSync(Buffer.from(body))
      headers.set('content-encoding', encoding)
      headers.set('content-length', String(compressed.byteLength))
      headers.set('transfer-encoding', 'chunked')
    }
    return new Response(status === 204 ? null : body, { status, headers })
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })
async function response() {
  const { GET } = await import('@/app/api/auth/[...path]/route')
  return GET(new Request('http://localhost/api/auth/get-session?neon_auth_session_verifier=synthetic-verifier'), { params: Promise.resolve({ path: ['get-session'] }) })
}

describe('Neon Auth decoded response transport', () => {
  it.each(['gzip', 'br'] as const)('serves decoded %s session JSON without stale upstream encoding/length', async value => {
    encoding = value
    const result = await response()
    expect(result.status).toBe(200)
    expect(result.headers.get('content-encoding')).toBeNull()
    expect(result.headers.get('content-length')).toBeNull()
    expect(result.headers.get('transfer-encoding')).toBeNull()
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(result.headers.getSetCookie().some(cookie => cookie.startsWith('__Secure-neon-auth.session_token=synthetic-only;'))).toBe(true)
    expect(result.headers.getSetCookie().some(cookie => cookie.startsWith('__Secure-neon-auth.local.session_data='))).toBe(true)
    expect((await result.json()).user.id).toBe('fixture-B')
  })

  it('delivers parseable session JSON through a real loopback HTTP response', async () => {
    encoding = 'gzip'
    const server = createServer(async (_request, outgoing) => {
      try {
        const result = await response()
        outgoing.statusCode = result.status
        result.headers.forEach((value, key) => { if (key !== 'set-cookie' && key !== 'transfer-encoding') outgoing.setHeader(key, value) })
        outgoing.setHeader('set-cookie', result.headers.getSetCookie())
        outgoing.end(Buffer.from(await result.arrayBuffer()))
      } catch { outgoing.statusCode = 500; outgoing.end('synthetic relay failure') }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as AddressInfo
      const result = await nativeFetch(`http://127.0.0.1:${address.port}/api/auth/get-session`, { signal: AbortSignal.timeout(5000) })
      expect(result.status).toBe(200)
      // Successful headers/cookies alone do not prove the browser can read JSON.
      expect((await result.json()).user.id).toBe('fixture-B')
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('preserves upstream error status and body after decoding', async () => {
    encoding = 'gzip'; status = 503
    const result = await response()
    expect(result.status).toBe(503)
    expect(result.headers.get('content-encoding')).toBeNull()
    expect(await result.json()).toEqual({ code: 'SYNTHETIC_FAILURE' })
  })

  it('keeps ordinary uncompressed session/cookie responses intact', async () => {
    const result = await response()
    expect(result.status).toBe(200)
    expect(result.headers.getSetCookie().length).toBeGreaterThan(0)
    expect((await result.json()).session.id).toBe('synthetic-session')
  })

  it('keeps a no-content response body absent', async () => {
    status = 204
    const result = await response()
    expect(result.status).toBe(204)
    expect(result.body).toBeNull()
  })
})
