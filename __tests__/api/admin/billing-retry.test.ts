import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  retryFixPackUsage: vi.fn(),
}))

vi.mock('@/lib/admin-guard', () => ({ requireApiAdmin: mocks.requireApiAdmin }))
vi.mock('@/lib/billing/usage', () => ({ retryFixPackUsage: mocks.retryFixPackUsage }))

import { POST } from '@/app/api/admin/billing/usage/[eventId]/retry/route'

const EVENT_ID = '11111111-2222-4333-8444-555555555555'
const context = { params: Promise.resolve({ eventId: EVENT_ID }) }

function adminResponse(status: number) {
  return { ok: false, response: new Response(JSON.stringify({ error: 'denied' }), { status }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireApiAdmin.mockResolvedValue({ ok: true, profile: { id: 'admin-1', is_admin: true } })
})

describe('POST /api/admin/billing/usage/[eventId]/retry', () => {
  it('rejects a non-admin before touching billing state', async () => {
    mocks.requireApiAdmin.mockResolvedValue(adminResponse(403))

    const response = await POST(new Request('http://localhost', { method: 'POST' }), context)

    expect(response.status).toBe(403)
    expect(mocks.retryFixPackUsage).not.toHaveBeenCalled()
  })

  it('rejects a malformed usage id without a database lookup', async () => {
    const response = await POST(
      new Request('http://localhost', { method: 'POST' }),
      { params: Promise.resolve({ eventId: 'not-a-uuid' }) },
    )

    expect(response.status).toBe(400)
    expect(mocks.retryFixPackUsage).not.toHaveBeenCalled()
  })

  it('returns the retried state when the meter event succeeds', async () => {
    mocks.retryFixPackUsage.mockResolvedValue({ status: 'reported' })

    const response = await POST(new Request('http://localhost', { method: 'POST' }), context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, state: 'reported' })
    expect(mocks.retryFixPackUsage).toHaveBeenCalledWith(EVENT_ID)
  })

  it.each([
    ['not_found', 404],
    ['not_retryable', 409],
    ['retry_window_elapsed', 409],
    ['attempts_exhausted', 409],
    ['failed', 502],
  ])('maps %s to %i', async (status, expected) => {
    mocks.retryFixPackUsage.mockResolvedValue({ status })

    const response = await POST(new Request('http://localhost', { method: 'POST' }), context)

    expect(response.status).toBe(expected)
  })

  it('returns 500 rather than a success when the retry fails to run', async () => {
    mocks.retryFixPackUsage.mockRejectedValue(new Error('connection terminated'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await POST(new Request('http://localhost', { method: 'POST' }), context)

    expect(response.status).toBe(500)
    consoleError.mockRestore()
  })
})
