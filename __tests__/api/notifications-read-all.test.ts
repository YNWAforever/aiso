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

import { PUT } from '@/app/api/notifications/read-all/route'
import { getProfile } from '@/lib/auth'

const PROFILE = { account_id: 'acc-1' } as never

beforeEach(() => {
  queries.length = 0
  params.length = 0
  nextResults = []
  vi.mocked(getProfile).mockReset()
})

describe('PUT /api/notifications/read-all', () => {
  it('returns 401 without touching the database', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)

    const res = await PUT()

    expect(res.status).toBe(401)
    expect(queries).toHaveLength(0)
  })

  it('marks only the caller\'s unread notifications read', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [[]]

    await PUT()

    expect(queries[0]).toContain('update notifications')
    expect(queries[0]).toContain('account_id')
    expect(queries[0]).toContain('read')
    expect(params[0]).toContain('acc-1')
    expect(params[0]).toContain(false)
  })

  it('returns ok on success', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [[]]

    const body = await (await PUT()).json()

    expect(body).toEqual({ ok: true })
  })

  it('returns 500, never a 2xx, when the write throws', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [new Error('connection terminated')]

    expect((await PUT()).status).toBe(500)
  })
})
