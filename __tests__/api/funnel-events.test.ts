import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

async function post(body: string, headers: HeadersInit = { 'Content-Type': 'application/json' }) {
  const { POST } = await import('@/app/api/funnel-events/route')
  return POST(new NextRequest('http://localhost/api/funnel-events', { method: 'POST', headers, body }))
}

describe('POST /api/funnel-events', () => {
  it('accepts a redacted event without echoing its input', async () => {
    const response = await post(JSON.stringify({
      name: 'scan_completed', attemptId: '550e8400-e29b-41d4-a716-446655440000', locale: 'en', scanId: 'scan-1',
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(info).toHaveBeenCalledWith('[funnel]', expect.not.stringContaining('scan-1'))
  })

  it('rejects malformed, PII, and oversized payloads without echoing them', async () => {
    for (const body of [
      '{',
      JSON.stringify({ name: 'scan_completed', attemptId: '550e8400-e29b-41d4-a716-446655440000', locale: 'en', email: 'person@example.com' }),
      JSON.stringify({ name: 'scan_completed', attemptId: '550e8400-e29b-41d4-a716-446655440000', locale: 'en', metadata: { url: 'https://example.com' } }),
      JSON.stringify({ name: 'scan_completed', attemptId: '550e8400-e29b-41d4-a716-446655440000', locale: 'en', metadata: [{ results: ['raw report'] }] }),
      JSON.stringify({ name: 'scan_completed', attemptId: 'a'.repeat(2100), locale: 'en' }),
    ]) {
      const response = await post(body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid funnel event' })
    }
  })
})
