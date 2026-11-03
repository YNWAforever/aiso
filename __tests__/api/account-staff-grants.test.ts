import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The staff-grants API surface (Studio R3 A2a): who may call it, and that the
 * account comes from the SESSION, never the request. What the statements do
 * with it is proven against real Postgres in __tests__/staff-grants/store-sql.test.ts.
 */

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  listStaffGrants: vi.fn(),
  listStaffAudit: vi.fn(),
  createStaffGrant: vi.fn(),
  changeStaffGrant: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: mocks.getProfile }))
vi.mock('@/lib/staff-grants/store', () => ({
  listStaffGrants: mocks.listStaffGrants,
  listStaffAudit: mocks.listStaffAudit,
  createStaffGrant: mocks.createStaffGrant,
  changeStaffGrant: mocks.changeStaffGrant,
}))

import { GET, POST } from '@/app/api/account/staff-grants/route'
import { DELETE, PATCH } from '@/app/api/account/staff-grants/[grantId]/route'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const PROFILE = '22222222-2222-4222-8222-222222222222'
const GRANT = '33333333-3333-4333-8333-333333333333'

const post = (body: unknown) => new Request(`http://localhost/api/account/staff-grants?account_id=${OTHER}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
})
const ctx = (grantId: string) => ({ params: Promise.resolve({ grantId }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getProfile.mockResolvedValue({ id: PROFILE, account_id: ACCOUNT })
  mocks.listStaffGrants.mockResolvedValue([])
  mocks.listStaffAudit.mockResolvedValue([])
})

describe('staff grants API', () => {
  it('refuses an anonymous caller on every verb without touching the store', async () => {
    mocks.getProfile.mockResolvedValue(null)
    for (const response of [await GET(), await POST(post({ email: 'a@b.co' })), await PATCH(new Request('http://x'), ctx(GRANT)), await DELETE(new Request('http://x'), ctx(GRANT))]) {
      expect(response.status).toBe(401)
    }
    expect(Object.values(mocks).filter(fn => fn !== mocks.getProfile).every(fn => fn.mock.calls.length === 0)).toBe(true)
  })

  it('does not turn a session-store outage into "signed out"', async () => {
    mocks.getProfile.mockRejectedValue(new Error('session store down'))
    await expect(GET()).rejects.toThrow('session store down')
  })

  it('lists grants and audit for the session account, uncached', async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.listStaffGrants).toHaveBeenCalledWith(ACCOUNT)
    expect(mocks.listStaffAudit).toHaveBeenCalledWith(ACCOUNT)
  })

  it('answers 503, not an empty list, when the store fails', async () => {
    mocks.listStaffGrants.mockRejectedValue(new Error('boom'))
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'STAFF_GRANTS_UNAVAILABLE' })
  })

  it('grants in the session account (ignoring any account in the URL) with a normalised email', async () => {
    mocks.createStaffGrant.mockResolvedValue({ result: 'created', id: GRANT })
    const response = await POST(post({ email: '  Staff@Fimmick.com ' }))
    expect(response.status).toBe(201)
    expect(mocks.createStaffGrant).toHaveBeenCalledWith(ACCOUNT, PROFILE, 'staff@fimmick.com')
  })

  it('refuses extra keys, bad JSON and non-emails before writing', async () => {
    for (const body of [{ email: 'a@b.co', account_id: OTHER }, 'not json', { email: 'nope' }, []]) {
      const response = await POST(post(body))
      expect(response.status).toBe(400)
    }
    expect(mocks.createStaffGrant).not.toHaveBeenCalled()
  })

  it('answers ineligible and unknown addresses alike, and reports an existing grant', async () => {
    for (const result of ['not_eligible', 'not_member'] as const) {
      mocks.createStaffGrant.mockResolvedValueOnce({ result })
      const response = await POST(post({ email: 'x@fimmick.com' }))
      expect([response.status, (await response.json()).error]).toEqual([404, 'STAFF_NOT_ELIGIBLE'])
    }
    mocks.createStaffGrant.mockResolvedValueOnce({ result: 'exists', id: GRANT })
    expect((await POST(post({ email: 'x@fimmick.com' }))).status).toBe(409)
  })

  it('renews and revokes within the session account, 404 for anything that does not match', async () => {
    mocks.changeStaffGrant.mockResolvedValue(true)
    expect((await PATCH(new Request('http://x'), ctx(GRANT))).status).toBe(200)
    expect(mocks.changeStaffGrant).toHaveBeenLastCalledWith(ACCOUNT, PROFILE, GRANT, 'renew')
    expect((await DELETE(new Request('http://x'), ctx(GRANT))).status).toBe(200)
    expect(mocks.changeStaffGrant).toHaveBeenLastCalledWith(ACCOUNT, PROFILE, GRANT, 'revoke')
    mocks.changeStaffGrant.mockResolvedValue(false)
    expect((await DELETE(new Request('http://x'), ctx(GRANT))).status).toBe(404)
  })

  it('answers 404 for a malformed id without reaching the database', async () => {
    const response = await PATCH(new Request('http://x'), ctx('not-a-uuid'))
    expect(response.status).toBe(404)
    expect(mocks.changeStaffGrant).not.toHaveBeenCalled()
  })
})
