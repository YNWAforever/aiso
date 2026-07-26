import { describe, it, expect, vi, beforeEach } from 'vitest'

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

const getProfileMock = vi.fn()
vi.mock('@/lib/auth', () => ({ getProfile: () => getProfileMock() }))

const ADMIN = { id: 'admin-1', account_id: 'acc-admin', is_admin: true }

function queryText(strings: unknown) {
  return Array.isArray(strings) ? (strings as string[]).join('?') : String(strings)
}

async function get() {
  const { GET } = await import('@/app/api/admin/clients/route')
  return GET()
}

describe('GET /api/admin/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    getProfileMock.mockReturnValue(ADMIN)
  })

  it('returns 403 for a signed-in non-admin', async () => {
    getProfileMock.mockReturnValue({ ...ADMIN, is_admin: false })
    expect((await get()).status).toBe(403)
  })

  it('returns 401 when signed out', async () => {
    getProfileMock.mockReturnValue(null)
    expect((await get()).status).toBe(401)
  })

  it('resolves entitlement server-side, including a live override', async () => {
    sqlMock.mockResolvedValue([{
      id: 'acc-1', plan: 'basic', status: 'active',
      stripe_subscription_id: null, trial_ends_at: null,
      override_plan: 'enterprise', override_reason: 'partner', override_expires_at: null,
      override_set_by: 'admin-1', created_at: '2026-01-01T00:00:00Z',
      display_name: 'Acme', clients: [],
    }])
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0].entitlement.plan).toBe('enterprise')
    expect(body[0].entitlement.source).toBe('override')
    expect(body[0].hasSubscription).toBe(false)
  })

  it('does not leak the raw Stripe subscription id', async () => {
    sqlMock.mockResolvedValue([{
      id: 'acc-1', plan: 'pro', status: 'active',
      stripe_subscription_id: 'sub_secret', trial_ends_at: null,
      override_plan: null, override_reason: null, override_expires_at: null,
      override_set_by: null, created_at: '2026-01-01T00:00:00Z',
      display_name: 'Acme', clients: [],
    }])
    const body = await (await get()).json()
    expect(body[0].stripe_subscription_id).toBeUndefined()
    expect(body[0].hasSubscription).toBe(true)
  })

  it('returns 5xx when the query fails rather than an empty list', async () => {
    sqlMock.mockRejectedValue(new Error('connection failed'))
    const res = await get()
    expect(res.status).toBeGreaterThanOrEqual(500)
  })

  it('queries via Neon, not the deleted Supabase project', async () => {
    sqlMock.mockResolvedValue([])
    await get()
    expect(sqlMock).toHaveBeenCalled()
    expect(queryText(sqlMock.mock.calls[0][0]).toLowerCase()).toContain('from accounts')
  })
})
