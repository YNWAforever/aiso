import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getProfileMock = vi.hoisted(() => vi.fn())

const queries: string[] = []
let nextResults: unknown[][] = []

const mockSql = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})

vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))
vi.mock('@/lib/db', () => ({ db: () => mockSql }))

async function claim(scanId = 'scan-1') {
  const { POST } = await import('@/app/api/scans/[id]/claim/route')
  return POST(new NextRequest(`http://localhost/api/scans/${scanId}/claim`, { method: 'POST' }), {
    params: Promise.resolve({ id: scanId }),
  })
}

describe('POST /api/scans/[id]/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queries.length = 0
    nextResults = []
    getProfileMock.mockResolvedValue({ account_id: 'account-1' })
  })

  it('returns 401 when no profile exists', async () => {
    getProfileMock.mockResolvedValue(null)

    const response = await claim()

    expect(response.status).toBe(401)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('claims an unowned scan for the authenticated account', async () => {
    nextResults = [[{ id: 'scan-1' }]]

    const response = await claim()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: false })
    expect(queries[0]).toContain('account_id is null')
  })

  it('returns ok when the scan already belongs to the same account', async () => {
    nextResults = [[], [{ account_id: 'account-1' }]]

    const response = await claim()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: true })
    expect(queries).toHaveLength(2)
  })

  it('returns 409 when the scan belongs to another account', async () => {
    nextResults = [[], [{ account_id: 'account-2' }]]

    const response = await claim()

    expect(response.status).toBe(409)
  })

  it('returns 404 when the scan does not exist', async () => {
    nextResults = [[], []]

    const response = await claim()

    expect(response.status).toBe(404)
  })

  it('returns 500 when the update query throws', async () => {
    nextResults = [new Error('connection terminated') as never]

    const response = await claim()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to claim scan' })
  })

  it('returns 500 when the re-read after a no-op update throws', async () => {
    nextResults = [[], new Error('connection terminated') as never]

    const response = await claim()

    expect(response.status).toBe(500)
  })
})
