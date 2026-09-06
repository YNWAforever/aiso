import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ profile: vi.fn(), snapshot: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: h.profile }))
vi.mock('@/lib/observations/store', () => ({ loadObservationSnapshot: h.snapshot }))

import {
  ObservationServiceError,
  loadAuthenticatedObservations,
  observationErrorResponse,
} from '@/lib/observations/service'

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

describe('observation service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.profile.mockResolvedValue({ id: 'actor', account_id: ACCOUNT })
    h.snapshot.mockResolvedValue(DTO)
  })

  it('authenticates before parsing or reading observations', async () => {
    h.profile.mockResolvedValue(null)
    await expect(loadAuthenticatedObservations('bad', new URLSearchParams('limit=0')))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    expect(h.snapshot).not.toHaveBeenCalled()
  })

  it.each([
    ['bad', ''],
    ['00000000-0000-0000-0000-000000000000', ''],
    [CLIENT, 'limit=0'],
    [CLIENT, 'unknown=value'],
  ])('rejects invalid client/query input (%s, %s) without a source read', async (clientId, query) => {
    await expect(loadAuthenticatedObservations(clientId, new URLSearchParams(query)))
      .rejects.toMatchObject({ code: 'INVALID_OBSERVATION_QUERY', status: 400 })
    expect(h.snapshot).not.toHaveBeenCalled()
  })

  it('derives ownership from auth and returns the owned snapshot', async () => {
    await expect(loadAuthenticatedObservations(CLIENT, new URLSearchParams('platform=chatgpt'))).resolves.toBe(DTO)
    expect(h.snapshot).toHaveBeenCalledWith(ACCOUNT, CLIENT, expect.objectContaining({ platform: 'chatgpt', limit: 50 }))
  })

  it('maps missing and foreign clients to the same 404', async () => {
    h.snapshot.mockResolvedValue(null)
    await expect(loadAuthenticatedObservations(CLIENT, new URLSearchParams()))
      .rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND', status: 404 })
  })

  it.each(['profile', 'snapshot'] as const)('maps %s failure to 503 and logs allowlisted diagnostics only', async source => {
    const secret = 'postgresql://user:secret@example.invalid/db'
    h[source].mockRejectedValue(Object.assign(new Error(secret), { code: '23503', detail: secret, query: secret }))
    await expect(loadAuthenticatedObservations(CLIENT, new URLSearchParams()))
      .rejects.toMatchObject({ code: 'OBSERVATIONS_UNAVAILABLE', status: 503 })
    expect(console.error).toHaveBeenCalledWith({
      event: 'observation_operation_failed',
      operation: 'load',
      correlationId: expect.any(String),
      database: { code: '23503', category: 'foreign_key_violation' },
    })
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret)
  })

  it('returns a no-store error response without exposing unexpected diagnostics', async () => {
    const response = observationErrorResponse(new Error('secret'))
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ error: 'OBSERVATIONS_UNAVAILABLE' })
  })

  it('exposes the exact public error code and status', () => {
    const error = new ObservationServiceError('INVALID_OBSERVATION_QUERY')
    expect(error).toMatchObject({ code: 'INVALID_OBSERVATION_QUERY', status: 400 })
  })
})
