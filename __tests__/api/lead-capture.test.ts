/**
 * TDD: Lead capture flow
 * Tests POST /api/scan/lead — stores email after result page email gate
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Tagged-template SQL mock — called as sql`update scans set lead_email = ${email} where id = ${scanId}`
const sqlMock = vi.fn()

vi.mock('@/lib/db', () => ({
  db: () => sqlMock,
}))

describe('POST /api/scan/lead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sqlMock.mockResolvedValue([])
  })

  it('returns 400 when scanId is missing', async () => {
    const { POST } = await import('@/app/api/scan/lead/route')
    const req = new NextRequest('http://localhost/api/scan/lead', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/scanId/i)
  })

  it('returns 400 when email is missing', async () => {
    const { POST } = await import('@/app/api/scan/lead/route')
    const req = new NextRequest('http://localhost/api/scan/lead', {
      method: 'POST',
      body: JSON.stringify({ scanId: 'scan-abc' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/email/i)
  })

  it('returns 400 for invalid email format', async () => {
    const { POST } = await import('@/app/api/scan/lead/route')
    for (const bad of ['notanemail', 'missing@', '@nodomain.com', '']) {
      const req = new NextRequest('http://localhost/api/scan/lead', {
        method: 'POST',
        body: JSON.stringify({ scanId: 'scan-abc', email: bad }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req)
      expect(res.status, `expected 400 for: "${bad}"`).toBe(400)
    }
  })

  it('stores lowercase trimmed email on the scan record', async () => {
    const { POST } = await import('@/app/api/scan/lead/route')
    const req = new NextRequest('http://localhost/api/scan/lead', {
      method: 'POST',
      body: JSON.stringify({ scanId: 'scan-abc', email: '  USER@EXAMPLE.COM  ' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    // email was normalised before storage
    expect(sqlMock).toHaveBeenCalledTimes(1)
    const [strings, ...params] = sqlMock.mock.calls[0]
    expect((strings as string[]).join('?')).toMatch(/update scans set lead_email = \? where id = \?/i)
    expect(params).toEqual(['user@example.com', 'scan-abc'])
  })

  it('returns 200 with { ok: true } on success', async () => {
    const { POST } = await import('@/app/api/scan/lead/route')
    const req = new NextRequest('http://localhost/api/scan/lead', {
      method: 'POST',
      body: JSON.stringify({ scanId: 'scan-abc', email: 'user@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})
