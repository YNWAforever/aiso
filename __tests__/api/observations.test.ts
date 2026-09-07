import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ profile: vi.fn(), snapshot: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: h.profile }))
vi.mock('@/lib/observations/store', () => ({ loadObservationSnapshot: h.snapshot }))

import { GET } from '@/app/api/clients/[clientId]/observations/route'

const CLIENT = '20000000-0000-4000-8000-000000000001'
const ACCOUNT = '10000000-0000-4000-8000-000000000001'
const DTO = {
  schemaVersion: 1 as const,
  clientId: CLIENT,
  selectedWeek: null,
  weeks: [],
  questionsTruncated: false,
  questions: [],
  items: [],
  counts: { recordedRows: 0, successfulRows: 0, incompleteRows: 0 },
  nextCursor: null,
}
const request = (query = '') => new NextRequest(`http://localhost/api/clients/${CLIENT}/observations${query}`)

describe('GET /api/clients/[clientId]/observations', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.profile.mockResolvedValue({ id: 'actor', account_id: ACCOUNT })
    h.snapshot.mockResolvedValue(DTO)
  })

  it('independently rejects unauthenticated requests without SQL and disables caching', async () => {
    h.profile.mockResolvedValue(null)
    const response = await GET(request(), { params: Promise.resolve({ clientId: CLIENT }) })
    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(h.snapshot).not.toHaveBeenCalled()
  })

  it('awaits params, parses nextUrl search params, and returns no-store JSON', async () => {
    let resolveParams!: (value: { clientId: string }) => void
    const params = new Promise<{ clientId: string }>(resolve => { resolveParams = resolve })
    const pending = GET(request('?week=2026-09-01&limit=10'), { params })
    expect(h.profile).not.toHaveBeenCalled()
    resolveParams({ clientId: CLIENT })
    const response = await pending
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual(DTO)
    expect(h.snapshot).toHaveBeenCalledWith(ACCOUNT, CLIENT, expect.objectContaining({ week: '2026-09-01', limit: 10 }))
  })

  it.each([
    ['bad', '', 400, 'INVALID_OBSERVATION_QUERY'],
    [CLIENT, '?result=nope', 400, 'INVALID_OBSERVATION_QUERY'],
  ])('returns a no-store 400 for invalid route input', async (clientId, query, status, code) => {
    const response = await GET(request(query), { params: Promise.resolve({ clientId }) })
    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ error: code })
    expect(h.snapshot).not.toHaveBeenCalled()
  })

  it('returns the same no-store 404 for a foreign or missing client', async () => {
    h.snapshot.mockResolvedValue(null)
    const response = await GET(request(), { params: Promise.resolve({ clientId: CLIENT }) })
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ error: 'CLIENT_NOT_FOUND' })
  })

  it.each(['profile', 'snapshot'] as const)('returns no-store 503 for %s failure', async source => {
    h[source].mockRejectedValue(new Error('failure'))
    const response = await GET(request(), { params: Promise.resolve({ clientId: CLIENT }) })
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ error: 'OBSERVATIONS_UNAVAILABLE' })
  })
})
