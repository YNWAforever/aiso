import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: '__Secure-neon-auth.session_token=synthetic-session' }),
  cookies: async () => ({ set: vi.fn() }),
}))
const sql = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ db: () => sql }))
const upstream = vi.fn()
const id = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('E2E_FIXTURE_MODE', '0')
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.fixture.invalid/api/auth')
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'synthetic-auth-throttle-secret-'.repeat(2))
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('preserves a real SDK Auth 429 and retry time through every draft route without querying the DB', async () => {
  upstream.mockImplementation(async () => Response.json({ message: 'PRIVATE upstream detail' }, {
    status: 429, headers: { 'X-Retry-After': '9' },
  }))
  const collection = await import('@/app/api/clients/[clientId]/work-items/route')
  const item = await import('@/app/api/clients/[clientId]/work-items/[workItemId]/route')
  const context = { params: Promise.resolve({ clientId: id, workItemId: id }) }
  for (const [method, handler] of [
    ['GET', collection.GET], ['POST', collection.POST], ['GET', item.GET], ['PATCH', item.PATCH],
  ] as const) {
    const response = await handler(new Request(`https://app.fixture.invalid/api/clients/${id}/work-items`, { method }), context)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('9')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'AUTH_RATE_LIMITED', retryAfterSeconds: 9 })
  }
  const { GET } = await import('@/app/api/clients/[clientId]/opportunities/route')
  const suggestions = await GET(new Request(`https://app.fixture.invalid/api/clients/${id}/opportunities`), context)
  expect(suggestions.status).toBe(429)
  expect(suggestions.headers.get('Retry-After')).toBe('9')
  expect(await suggestions.json()).toEqual({ error: 'AUTH_RATE_LIMITED', retryAfterSeconds: 9 })
  expect(upstream).toHaveBeenCalledTimes(5)
  expect(sql).not.toHaveBeenCalled()
})

it('does not invent a deadline when the Auth service supplied none', async () => {
  upstream.mockImplementation(async () => Response.json({ message: 'PRIVATE throttle detail' }, { status: 429 }))
  const { PATCH } = await import('@/app/api/clients/[clientId]/work-items/[workItemId]/route')
  const response = await PATCH(new Request('https://app.fixture.invalid', { method: 'PATCH' }), {
    params: Promise.resolve({ clientId: id, workItemId: id }),
  })
  expect(response.status).toBe(429)
  expect(response.headers.has('Retry-After')).toBe(false)
  expect(await response.json()).toEqual({ error: 'AUTH_RATE_LIMITED', retryAfterSeconds: null })
  expect(sql).not.toHaveBeenCalled()
})

it('keeps a genuine Auth outage as unavailable instead of inventing a retry countdown', async () => {
  upstream.mockImplementation(async () => Response.json({ message: 'PRIVATE outage' }, { status: 503 }))
  const { PATCH } = await import('@/app/api/clients/[clientId]/work-items/[workItemId]/route')
  const response = await PATCH(new Request('https://app.fixture.invalid', { method: 'PATCH' }), {
    params: Promise.resolve({ clientId: id, workItemId: id }),
  })
  expect(response.status).toBe(503)
  expect(response.headers.has('Retry-After')).toBe(false)
  expect(await response.json()).toEqual({ error: 'WORK_ITEMS_UNAVAILABLE' })
  expect(sql).not.toHaveBeenCalled()
})
