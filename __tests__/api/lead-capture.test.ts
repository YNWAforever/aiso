/**
 * TDD: Lead capture flow
 * Tests POST /api/scan/lead — stores email after result page email gate
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const updateMock = vi.fn()
const eqMock     = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      update: updateMock,
      eq:     eqMock,
    }),
  },
}))

describe('POST /api/scan/lead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateMock.mockReturnValue({ eq: eqMock })
    eqMock.mockResolvedValue({ error: null })
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
    expect(updateMock).toHaveBeenCalledWith({ lead_email: 'user@example.com' })
    expect(eqMock).toHaveBeenCalledWith('id', 'scan-abc')
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
