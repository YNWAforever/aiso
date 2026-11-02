import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeSearchConsole = vi.hoisted(() => vi.fn())
const queryStudioGsc = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/search-console/guard', () => ({ authorizeSearchConsole }))
vi.mock('@/lib/conversation-studio/gsc-query', () => ({ queryStudioGsc }))

const clientId = '11111111-1111-4111-8111-111111111111'
const allowed = {
  ok: true,
  profile: { id: 'p', account_id: 'account-a', accounts: { plan: 'pro' } },
  client: { id: clientId, status: 'active' },
}

async function post(id = clientId) {
  const { POST } = await import('@/app/api/dashboard/clients/[clientId]/studio/search-console/route')
  return POST(new Request('https://app.test/api/studio/search-console', { method: 'POST' }), { params: Promise.resolve({ clientId: id }) })
}

beforeEach(() => {
  authorizeSearchConsole.mockReset().mockResolvedValue(allowed)
  queryStudioGsc.mockReset().mockResolvedValue({
    status: 'ok', country: 'hkg', completeness: 'complete',
    window: { startDate: '2026-10-03', endDate: '2026-10-30', timeZone: 'America/Los_Angeles', lagDays: 3 },
    totals: { clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
  })
})

describe('POST studio search-console', () => {
  it('uses the existing guard, returns a snapshot and forbids caching', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(authorizeSearchConsole).toHaveBeenCalledWith(clientId)
    expect(queryStudioGsc).toHaveBeenCalledWith({ accountId: 'account-a', clientId })
    expect(await response.json()).toMatchObject({ snapshot: { status: 'ok', country: 'hkg' } })
  })

  it('passes through 401 unauthenticated', async () => {
    authorizeSearchConsole.mockResolvedValue({ ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await post()).status).toBe(401)
    expect(queryStudioGsc).not.toHaveBeenCalled()
  })

  it.each([
    ['not found', 404], ['UPGRADE_REQUIRED', 403],
  ])('passes through the guard denial %s', async (_label, status) => {
    authorizeSearchConsole.mockResolvedValue({ ok: false, response: Response.json({ error: 'denied' }, { status }) })
    expect((await post()).status).toBe(status)
    expect(queryStudioGsc).not.toHaveBeenCalled()
  })

  it('is 404 for a foreign or inactive brand before any Google read', async () => {
    authorizeSearchConsole.mockResolvedValue({ ...allowed, client: { id: clientId, status: 'archived' } })
    expect((await post()).status).toBe(404)
    expect(queryStudioGsc).not.toHaveBeenCalled()
  })

  it.each(['unbound', 'reconnect', 'rebind'])('returns the honest %s state', async status => {
    queryStudioGsc.mockResolvedValue({ status, country: 'hkg', completeness: 'unknown' })
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ snapshot: { status, country: 'hkg', completeness: 'unknown' } })
  })

  it.each(['quota', 'unavailable'])('returns the honest %s state without metrics', async status => {
    queryStudioGsc.mockResolvedValue({ status, country: 'hkg', completeness: 'unknown' })
    expect((await (await post()).json()).snapshot.status).toBe(status)
  })

  it('turns an unexpected dependency failure into an honest no-store snapshot', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    queryStudioGsc.mockRejectedValue(new Error('secret {{SECRET_7k4m9p2q}}'))
    try {
      const response = await post()
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      const body = await response.json()
      expect(body.snapshot).toMatchObject({ status: 'unavailable', country: 'hkg', completeness: 'unknown' })
      expect(JSON.stringify(body)).not.toContain('{{SECRET_7k4m9p2q}}')
    } finally { error.mockRestore() }
  })
})
