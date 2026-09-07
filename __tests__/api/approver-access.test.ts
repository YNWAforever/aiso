vi.mock('server-only', () => ({}))

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn(), list: vi.fn(), mutate: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ requireApiAdmin: mocks.admin }))
vi.mock('@/lib/approvals/access-store', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/approvals/access-store')>(),
  listApproverAccess: mocks.list,
  mutateApproverAccess: mocks.mutate,
}))

import * as approversRoute from '@/app/api/admin/accounts/[accountId]/approvers/route'

const accountId = '00000000-0000-4000-8000-000000000001'
const actorId = '00000000-0000-4000-8000-000000000002'
const profileId = '00000000-0000-4000-8000-000000000003'
const requestId = '00000000-0000-4000-8000-000000000004'
const params = Promise.resolve({ accountId })
const event = { id: requestId, profileId, action: 'grant' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.admin.mockResolvedValue({ ok: true, profile: { id: actorId } })
})

describe('approver access route contract', () => {
  it('exports only GET and POST', () => {
    expect(Object.keys(approversRoute).sort()).toEqual(['GET', 'POST'])
  })

  it('uses the real independent admin guard before query parsing or request body parsing', async () => {
    mocks.admin.mockImplementation(async () => ({ ok: false, response: Response.json({ error: 'FORBIDDEN' }, { status: 403 }) }))
    const responses = await Promise.all([
      approversRoute.GET(new Request('http://localhost/api?unknown=1'), { params }),
      approversRoute.POST(new Request('http://localhost/api', { method: 'POST', body: '{' }), { params }),
    ])
    for (const response of responses) {
      expect(response.status).toBe(403)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ error: 'FORBIDDEN' })
    }
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('forwards awaited account params and parsed independent cursors', async () => {
    mocks.list.mockResolvedValue({ kind: 'created', value: { members: [], events: [], nextMemberCursor: null, nextEventCursor: null } })
    const response = await approversRoute.GET(new Request(`http://localhost/api?limit=9&memberCursor=${profileId}`), { params })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.list).toHaveBeenCalledWith(actorId, accountId, { limit: 9, memberCursor: profileId, eventCursor: null })
  })

  it('preserves new-event 201, identical replay 200, and rejects forged role fields', async () => {
    mocks.mutate.mockResolvedValueOnce({ kind: 'created', value: event }).mockResolvedValueOnce({ kind: 'replayed', value: event })
    const post = (body: unknown) => approversRoute.POST(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }), { params })
    const input = { profileId, action: 'grant', reason: 'Review duty', expectedRevision: 0, requestId }
    const created = await post(input)
    const replayed = await post(input)
    expect([created.status, replayed.status]).toEqual([201, 200])
    expect(created.headers.get('cache-control')).toBe('no-store')
    const forged = await post({ ...input, isAdmin: true })
    expect(forged.status).toBe(400)
    expect(await forged.json()).toEqual({ error: 'INVALID_APPROVAL_INPUT' })
    expect(mocks.mutate).toHaveBeenCalledTimes(2)
  })

  it('enforces the 16 KiB streamed mutation limit with a stable no-store error', async () => {
    const response = await approversRoute.POST(new Request('http://localhost/api', { method: 'POST', body: 'x'.repeat(16385) }), { params })
    expect(response.status).toBe(413)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'APPROVAL_BODY_TOO_LARGE' })
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
})
