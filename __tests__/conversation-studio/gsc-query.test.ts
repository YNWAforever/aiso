import { describe, expect, it, vi } from 'vitest'
import { GoogleApiError } from '@/lib/integrations/google/oauth'
import { DeadlineReachedError } from '@/lib/integrations/search-console/client'
import { GSC_STUDIO_DEADLINE_MS, GSC_TOTALS_ROW_LIMIT, GSC_TOP_QUERY_LIMIT, queryStudioGsc, type StudioGscDeps } from '@/lib/conversation-studio/gsc-query'
import type { BindingRow } from '@/lib/integrations/search-console/store'

vi.mock('server-only', () => ({}))

const nowMs = Date.parse('2026-11-02T18:00:00Z')
const binding: BindingRow = {
  connectionId: '22222222-2222-4222-8222-222222222222', siteUrl: 'sc-domain:example.com',
  permissionLevel: 'siteOwner', boundDomain: 'example.com', backfillPending: false,
  connectionStatus: 'active', currentDomain: 'example.com', boundAt: '2026-10-27T00:00:00Z',
}
const sealed = { ciphertext: Buffer.from('sealed'), keyId: 'k' }

function deps(overrides: Partial<StudioGscDeps> = {}): StudioGscDeps {
  return {
    loadBinding: vi.fn().mockResolvedValue(binding),
    loadSecret: vi.fn().mockResolvedValue({ status: 'active', sealed }),
    open: vi.fn().mockReturnValue('refresh-token'),
    refresh: vi.fn().mockResolvedValue('access-token'),
    query: vi.fn().mockResolvedValue([
      { keys: ['2026-10-30'], clicks: 12, impressions: 300, ctr: 0.04, position: 4.5 },
      { keys: ['2026-10-29'], clicks: 8, impressions: 200, ctr: 0.04, position: 5.5 },
    ]),
    now: vi.fn().mockReturnValue(nowMs),
    ...overrides,
  }
}

describe('queryStudioGsc', () => {
  it('queries only Hong Kong for the Pacific answer window and caps both series', async () => {
    const d = deps()
    const snapshot = await queryStudioGsc({ accountId: 'account-a', clientId: 'client-a' }, d)
    expect(snapshot).toMatchObject({
      status: 'ok', country: 'hkg', completeness: 'complete',
      window: { startDate: '2026-10-03', endDate: '2026-10-30', timeZone: 'America/Los_Angeles', lagDays: 3 },
      totals: { clicks: 20, impressions: 500, ctr: 0.04, position: 4.9 },
    })
    const calls = vi.mocked(d.query).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]![2]).toMatchObject({
      dimensions: ['date'], countryEquals: 'hkg', startDate: '2026-10-03', endDate: '2026-10-30',
      rowLimit: GSC_TOTALS_ROW_LIMIT, deadline: nowMs + GSC_STUDIO_DEADLINE_MS,
    })
    expect(calls[1]![2]).toMatchObject({ dimensions: ['query'], countryEquals: 'hkg', rowLimit: GSC_TOP_QUERY_LIMIT })
    expect(GSC_TOTALS_ROW_LIMIT).toBeLessThanOrEqual(100)
    expect(GSC_TOP_QUERY_LIMIT).toBeLessThanOrEqual(25)
  })

  it('maps query rows into top queries without adding rows Google did not send', async () => {
    const d = deps({
      query: vi.fn()
        .mockResolvedValueOnce([{ keys: ['2026-10-30'], clicks: 12, impressions: 300, ctr: 0.04, position: 4.5 }])
        .mockResolvedValueOnce([{ keys: ['buy widgets'], clicks: 5, impressions: 100, ctr: 0.05, position: 3 }]),
    })
    const snapshot = await queryStudioGsc({ accountId: 'a', clientId: 'c' }, d)
    expect(snapshot.topQueries).toEqual([{ query: 'buy widgets', clicks: 5, impressions: 100 }])
  })

  it('returns empty, not zero totals, when Google returns no rows', async () => {
    const d = deps({ query: vi.fn().mockResolvedValue([]) })
    const snapshot = await queryStudioGsc({ accountId: 'a', clientId: 'c' }, d)
    expect(snapshot.status).toBe('empty')
    expect(snapshot.totals).toBeUndefined()
    expect(snapshot.completeness).toBe('unknown')
    expect(d.query).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['revoked', 'reconnect'], ['forbidden', 'forbidden'], ['quota', 'quota'],
    ['unavailable', 'unavailable'], ['misconfigured', 'misconfigured'],
  ] as const)('maps Google %s to %s', async (kind, status) => {
    const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError(kind, 429)) })
    const snapshot = await queryStudioGsc({ accountId: 'a', clientId: 'c' }, d)
    expect(snapshot.status).toBe(status)
    expect(snapshot.totals).toBeUndefined()
    expect(d.query).not.toHaveBeenCalled()
  })

  it('maps a deadline to unavailable without fabricating metrics', async () => {
    const d = deps({ query: vi.fn().mockRejectedValue(new DeadlineReachedError()) })
    const snapshot = await queryStudioGsc({ accountId: 'a', clientId: 'c' }, d)
    expect(snapshot).toMatchObject({ status: 'unavailable', completeness: 'unknown' })
    expect(snapshot.totals).toBeUndefined()
  })

  it('keeps totals when only the optional top-query series fails', async () => {
    const d = deps({
      query: vi.fn().mockResolvedValueOnce([{ keys: ['2026-10-30'], clicks: 2, impressions: 20, ctr: 0.1, position: 2 }])
        .mockRejectedValueOnce(new GoogleApiError('quota', 429)),
    })
    const snapshot = await queryStudioGsc({ accountId: 'a', clientId: 'c' }, d)
    expect(snapshot).toMatchObject({ status: 'ok', totals: { clicks: 2, impressions: 20 } })
    expect(snapshot.topQueries).toBeUndefined()
  })

  it.each([
    [null, 'unbound'],
    [{ ...binding, connectionStatus: 'revoked' }, 'unbound'],
    [{ ...binding, connectionStatus: 'needs_reconnect' }, 'reconnect'],
    [{ ...binding, currentDomain: 'other.example' }, 'rebind'],
  ] as const)('does not call Google for binding state %#', async (row, status) => {
    const d = deps({ loadBinding: vi.fn().mockResolvedValue(row) })
    expect((await queryStudioGsc({ accountId: 'a', clientId: 'c' }, d)).status).toBe(status)
    expect(d.refresh).not.toHaveBeenCalled()
    expect(d.query).not.toHaveBeenCalled()
  })

  it('does not call Google when the sealed credential is absent', async () => {
    const d = deps({ loadSecret: vi.fn().mockResolvedValue({ status: 'active', sealed: null }) })
    expect((await queryStudioGsc({ accountId: 'a', clientId: 'c' }, d)).status).toBe('reconnect')
    expect(d.refresh).not.toHaveBeenCalled()
    expect(d.query).not.toHaveBeenCalled()
  })
})
