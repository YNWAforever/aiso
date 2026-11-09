import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ submit: vi.fn() }))
vi.mock('@/lib/monthly-report/review', () => ({ submitMonthlyReview: h.submit }))

import { POST } from '@/app/api/public/monthly-reports/review/route'

const request = (body: unknown, raw = false) => new Request('http://localhost/api/public/monthly-reports/review', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: raw ? String(body) : JSON.stringify(body),
})
const valid = { slug: 's'.repeat(32), review: '1794000000.' + 'a'.repeat(43), decision: 'approved' }

beforeEach(() => { vi.clearAllMocks() })

describe('POST /api/public/monthly-reports/review', () => {
  it('records a decision and answers 201 with the recorded decision', async () => {
    h.submit.mockResolvedValue({ state: 'recorded', decision: 'approved', decidedAt: '2026-12-05T02:00:00.000Z' })
    const response = await POST(request(valid))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ decision: 'approved', decidedAt: '2026-12-05T02:00:00.000Z' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(h.submit).toHaveBeenCalledWith(valid)
  })

  it.each([
    [{ state: 'invalid' }, 400],
    [{ state: 'not_found' }, 404],
    [{ state: 'already', decision: 'approved' }, 409],
  ])('maps %j to %i', async (result, status) => {
    h.submit.mockResolvedValue(result)
    expect((await POST(request(valid))).status).toBe(status)
  })

  it('answers 429 with Retry-After when the token has spent its allowance', async () => {
    h.submit.mockResolvedValue({ state: 'rate_limited', retryAt: Date.now() + 42_000 })
    const response = await POST(request(valid))
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it.each([
    ['malformed JSON', 'not-json'],
    ['an oversized body', 'x'.repeat(3 * 1024)],
  ])('rejects %s before the service is called', async (_label, payload) => {
    expect((await POST(request(payload, true))).status).toBe(400)
    expect(h.submit).not.toHaveBeenCalled()
  })

  it('rejects a non-object JSON body through the service validator', async () => {
    h.submit.mockResolvedValue({ state: 'invalid' })
    expect((await POST(request([], false))).status).toBe(400)
    expect(h.submit).toHaveBeenCalledWith([])
  })

  it('fails closed with 503 when the decision could not be recorded safely', async () => {
    h.submit.mockRejectedValue(new Error('PRIVATE_LEDGER_SENTINEL'))
    const response = await POST(request(valid))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('PRIVATE_')
  })
})
