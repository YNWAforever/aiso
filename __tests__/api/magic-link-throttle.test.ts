import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const upstream = vi.fn()
beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.fixture.invalid/api/auth')
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'synthetic-magic-link-throttle-secret-'.repeat(2))
  vi.stubGlobal('fetch', upstream)
  upstream.mockReset()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const input = { email: 'synthetic@fixture-aiso.example',
  callbackURL: 'https://app.fixture.invalid/zh-HK/auth/complete?next=%2Fzh-HK%2Fdashboard' }
async function send() {
  const { POST } = await import('@/app/api/auth/[...path]/route')
  return POST(new Request('https://app.fixture.invalid/api/auth/sign-in/magic-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://app.fixture.invalid' },
    body: JSON.stringify(input),
  }), { params: Promise.resolve({ path: ['sign-in', 'magic-link'] }) })
}
it('preserves a magic-link Auth 429 and its real wait, without forwarding private error details', async () => {
  upstream.mockImplementation(async () => Response.json({ message: 'PRIVATE upstream throttle' }, {
    status: 429, headers: { 'X-Retry-After': '60' },
  }))
  const result = await send()
  expect(result.status).toBe(429)
  expect(result.headers.get('Retry-After')).toBe('60')
  expect(result.headers.get('cache-control')).toBe('private, no-store')
  expect(await result.json()).toEqual({ error: 'AUTH_RATE_LIMITED', retryAfterSeconds: 60 })
  expect(upstream).toHaveBeenCalledTimes(1)
})
it('keeps one ordinary magic-link request and its callback body unchanged', async () => {
  upstream.mockImplementation(async () => Response.json({ status: true }))
  expect(await (await send()).json()).toEqual({ status: true })
  expect(upstream).toHaveBeenCalledTimes(1)
  const [url, init] = upstream.mock.calls[0]
  expect(new URL(url).pathname).toBe('/api/auth/sign-in/magic-link')
  expect(JSON.parse(init.body)).toEqual(input)
})
it('retains SDK-processed clearing cookies when a magic-link request is throttled', async () => {
  upstream.mockImplementation(async () => Response.json({}, {
    status: 429, headers: {
      'X-Retry-After': '60',
      'set-cookie': '__Secure-neon-auth.session_token=; Max-Age=0; Path=/; Secure; HttpOnly',
    },
  }))
  const result = await send()
  expect(result.headers.getSetCookie().some(value =>
    value.startsWith('__Secure-neon-auth.session_token=;') && /max-age=0/i.test(value))).toBe(true)
})
it('keeps an unknown wait unknown and a genuine outage distinct', async () => {
  upstream.mockImplementation(async () => Response.json({}, { status: 429 }))
  const limited = await send()
  expect(limited.status).toBe(429)
  expect(limited.headers.has('Retry-After')).toBe(false)
  expect(await limited.json()).toEqual({ error: 'AUTH_RATE_LIMITED', retryAfterSeconds: null })
  upstream.mockImplementation(async () => Response.json({ code: 'SYNTHETIC_OUTAGE' }, { status: 503 }))
  const unavailable = await send()
  expect(unavailable.status).toBe(503)
  expect(unavailable.headers.has('Retry-After')).toBe(false)
  expect(await unavailable.json()).toEqual({ code: 'SYNTHETIC_OUTAGE' })
})
