import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

describe('POST /api/webhooks/neon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sqlMock.mockResolvedValue([{ id: 'account-abc' }])
  })

  it('returns 400 for an unrecognized event type', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    const req = new NextRequest('http://localhost/api/webhooks/neon', {
      method: 'POST',
      body: JSON.stringify({ type: 'something.else', data: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('provisions an account and profile on user.created', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    const req = new NextRequest('http://localhost/api/webhooks/neon', {
      method: 'POST',
      body: JSON.stringify({
        type: 'user.created',
        data: { id: 'user-123', email: 'new@example.com', name: 'New User' },
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    // First call creates the account, second links the profile
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })
})
