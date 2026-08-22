import { describe, it, expect, vi, beforeEach } from 'vitest'

const queries: string[] = []
const params: unknown[][] = []
let nextResults: unknown[] = []

const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  queries.push(strings.join('?'))
  params.push(values)
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})
vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

import { GET } from '@/app/api/notifications/route'
import { getProfile } from '@/lib/auth'

const PROFILE = { account_id: 'acc-1' } as never

beforeEach(() => {
  queries.length = 0
  params.length = 0
  nextResults = []
  vi.mocked(getProfile).mockReset()
})

describe('GET /api/notifications', () => {
  it('returns 401 without touching the database', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)

    const res = await GET()

    expect(res.status).toBe(401)
    expect(queries).toHaveLength(0)
  })

  it('returns the caller\'s notifications, most recent first', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    const rows = [
      { id: 'n-2', account_id: 'acc-1', title: 'Newer', created_at: '2026-08-20T00:00:00.000Z' },
      { id: 'n-1', account_id: 'acc-1', title: 'Older', created_at: '2026-08-01T00:00:00.000Z' },
    ]
    nextResults = [rows]

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.notifications).toEqual(rows)
  })

  it('scopes the query to the caller\'s account_id', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [[]]

    await GET()

    expect(queries[0]).toContain('from notifications')
    expect(queries[0]).toContain('account_id')
    expect(params[0]).toContain('acc-1')
  })

  it('returns an empty array when the account has no notifications', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [[]]

    const body = await (await GET()).json()

    expect(body.notifications).toEqual([])
  })

  it('returns 503 rather than a misleading empty list when the query throws', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [new Error('connection terminated')]

    expect((await GET()).status).toBe(503)
  })
})
