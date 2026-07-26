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

import { NextRequest } from 'next/server'

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/clients', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

async function patch(body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/admin/clients/route')
  return PATCH(patchRequest(body))
}

describe('PATCH /api/admin/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    getProfileMock.mockReturnValue(ADMIN)
    sqlMock.mockResolvedValue([{ id: 'acc-1' }])
  })

  it('returns 403 for a non-admin', async () => {
    getProfileMock.mockReturnValue({ ...ADMIN, is_admin: false })
    expect((await patch({ accountId: 'acc-1', action: 'revoke' })).status).toBe(403)
  })

  it('grants an override and never writes accounts.plan', async () => {
    const res = await patch({
      accountId: 'acc-1', action: 'grant', plan: 'enterprise', reason: 'partner deal',
    })
    expect(res.status).toBe(200)
    const text = queryText(sqlMock.mock.calls[0][0]).toLowerCase()
    expect(text).toContain('override_plan')
    expect(text).not.toMatch(/set\s+plan\s*=/)
  })

  it('takes override_set_by from the session, not the body', async () => {
    await patch({
      accountId: 'acc-1', action: 'grant', plan: 'pro', reason: 'support',
      override_set_by: 'attacker', set_by: 'attacker',
    })
    const params = sqlMock.mock.calls[0].slice(1)
    expect(params).toContain('admin-1')
    expect(params).not.toContain('attacker')
  })

  it('accepts free as a downgrade comp', async () => {
    const res = await patch({
      accountId: 'acc-1', action: 'grant', plan: 'free', reason: 'abuse',
    })
    expect(res.status).toBe(200)
  })

  it('rejects a plan outside PLAN_IDS', async () => {
    const res = await patch({
      accountId: 'acc-1', action: 'grant', plan: 'platinum', reason: 'x',
    })
    expect(res.status).toBe(400)
  })

  it('rejects a grant with no reason', async () => {
    const res = await patch({ accountId: 'acc-1', action: 'grant', plan: 'pro', reason: '  ' })
    expect(res.status).toBe(400)
  })

  it('rejects an expiry in the past', async () => {
    const res = await patch({
      accountId: 'acc-1', action: 'grant', plan: 'pro', reason: 'x',
      expiresAt: '2020-01-01T00:00:00Z',
    })
    expect(res.status).toBe(400)
  })

  it('revokes by nulling all four override columns', async () => {
    const res = await patch({ accountId: 'acc-1', action: 'revoke' })
    expect(res.status).toBe(200)
    const text = queryText(sqlMock.mock.calls[0][0]).toLowerCase()
    expect(text).toContain('override_plan = null')
    expect(text).toContain('override_reason = null')
    expect(text).toContain('override_set_by = null')
    expect(text).toContain('override_expires_at = null')
  })

  it('returns 404 when the account does not exist', async () => {
    sqlMock.mockResolvedValue([])
    const res = await patch({ accountId: 'nope', action: 'revoke' })
    expect(res.status).toBe(404)
  })

  it('returns 5xx when the write fails', async () => {
    sqlMock.mockRejectedValue(new Error('connection failed'))
    const res = await patch({ accountId: 'acc-1', action: 'revoke' })
    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})
