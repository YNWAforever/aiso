import { describe, expect, it, vi } from 'vitest'
import { DataForSeoError } from '@/lib/integrations/dataforseo/types'
import {
  DFS_KEYWORD_LIMIT,
  DFS_WEEKLY_CAP_PER_BRAND,
  dfsWeekStart,
  queryStudioDfs,
  type StudioDfsDeps,
} from '@/lib/conversation-studio/dfs-query'

vi.mock('server-only', () => ({}))

const now = Date.parse('2026-11-02T04:00:00Z')
const config = { login: 'fixture-login', credential: 'x', locationCode: 2344, languageCode: 'zh-TW' }

function deps(overrides: Partial<StudioDfsDeps> = {}): StudioDfsDeps {
  return {
    credentials: vi.fn().mockReturnValue(config),
    isEnabled: vi.fn().mockResolvedValue(true),
    reserve: vi.fn().mockResolvedValue({ allowed: true, remaining: 19 }),
    search: vi.fn().mockResolvedValue({
      statusCode: 20000,
      items: [{ rank: 1, title: 'Example', url: 'https://example.com/a', domain: 'example.com' }],
    }),
    now: vi.fn().mockReturnValue(now),
    ...overrides,
  }
}

describe('dfsWeekStart', () => {
  it.each([
    ['2026-11-01T15:59:59Z', '2026-10-26'],
    ['2026-11-01T16:00:00Z', '2026-11-02'],
    ['2026-11-02T15:59:59Z', '2026-11-02'],
    ['2026-11-08T16:00:00Z', '2026-11-09'],
  ])('maps %s to the Hong Kong Monday %s', (iso, week) => {
    expect(dfsWeekStart(Date.parse(iso))).toBe(week)
  })
})

describe('queryStudioDfs', () => {
  it('reserves once and makes one Live Advanced call with the HKT week', async () => {
    const d = deps()
    const snapshot = await queryStudioDfs({ accountId: 'account-a', clientId: 'client-a', keyword: '  sourdough hong kong  ' }, d)
    expect(snapshot).toMatchObject({
      status: 'ok',
      keyword: 'sourdough hong kong',
      locationCode: 2344,
      languageCode: 'zh-TW',
      locationPending: true,
      week: { weekStart: '2026-11-02', timeZone: 'Asia/Hong_Kong', remaining: 19, cap: 20 },
      items: [{ rank: 1, title: 'Example', url: 'https://example.com/a', domain: 'example.com' }],
    })
    expect(d.reserve).toHaveBeenCalledTimes(1)
    expect(d.reserve).toHaveBeenCalledWith('account-a', 'client-a', '2026-11-02', 20)
    expect(d.search).toHaveBeenCalledTimes(1)
    expect(d.search).toHaveBeenCalledWith({ keyword: 'sourdough hong kong', locationCode: 2344, languageCode: 'zh-TW', depth: 10 })
    expect(DFS_WEEKLY_CAP_PER_BRAND).toBe(20)
  })

  it('refuses an over-long keyword before settings, reservation or network', async () => {
    const d = deps()
    const keyword = 'x'.repeat(DFS_KEYWORD_LIMIT + 1)
    const snapshot = await queryStudioDfs({ accountId: 'a', clientId: 'c', keyword: ` ${keyword} ` }, d)
    expect(snapshot).toMatchObject({ status: 'invalid', keyword, messageKey: 'dfs.keywordTooLong' })
    expect(d.isEnabled).not.toHaveBeenCalled()
    expect(d.reserve).not.toHaveBeenCalled()
    expect(d.search).not.toHaveBeenCalled()
  })

  it('accepts a keyword at the documented limit after trimming', async () => {
    const d = deps()
    const keyword = 'x'.repeat(DFS_KEYWORD_LIMIT)
    const snapshot = await queryStudioDfs({ accountId: 'a', clientId: 'c', keyword: ` ${keyword} ` }, d)
    expect(snapshot).toMatchObject({ status: 'ok', keyword })
    expect(d.search).toHaveBeenCalledWith({ keyword, locationCode: 2344, languageCode: 'zh-TW', depth: 10 })
  })

  it('returns disconnected before settings or network when env credentials are absent', async () => {
    const d = deps({ credentials: vi.fn().mockReturnValue(null) })
    const snapshot = await queryStudioDfs({ accountId: 'a', clientId: 'c', keyword: 'q' }, d)
    expect(snapshot).toMatchObject({ status: 'disconnected', locationPending: true })
    expect(d.isEnabled).not.toHaveBeenCalled()
    expect(d.reserve).not.toHaveBeenCalled()
    expect(d.search).not.toHaveBeenCalled()
  })

  it('returns disabled without reserving or calling the vendor', async () => {
    const d = deps({ isEnabled: vi.fn().mockResolvedValue(false) })
    const snapshot = await queryStudioDfs({ accountId: 'a', clientId: 'c', keyword: 'q' }, d)
    expect(snapshot).toMatchObject({ status: 'disabled', locationPending: true })
    expect(d.reserve).not.toHaveBeenCalled()
    expect(d.search).not.toHaveBeenCalled()
  })

  it('returns capped without a vendor call on the 21st reservation', async () => {
    const d = deps({ reserve: vi.fn().mockResolvedValue({ allowed: false, remaining: 0 }) })
    const snapshot = await queryStudioDfs({ accountId: 'a', clientId: 'c', keyword: 'q' }, d)
    expect(snapshot).toMatchObject({ status: 'capped', week: { remaining: 0, cap: 20 }, locationPending: true })
    expect(d.search).not.toHaveBeenCalled()
  })

  it('refuses an empty keyword before reserving', async () => {
    const d = deps()
    const snapshot = await queryStudioDfs({ accountId: 'a', clientId: 'c', keyword: '   ' }, d)
    expect(snapshot.status).toBe('invalid')
    expect(d.reserve).not.toHaveBeenCalled()
    expect(d.search).not.toHaveBeenCalled()
  })

  it('returns empty, not invented rows, when the vendor returns no organic items', async () => {
    const d = deps({ search: vi.fn().mockResolvedValue({ statusCode: 20000, items: [] }) })
    const snapshot = await queryStudioDfs({ accountId: 'a', clientId: 'c', keyword: 'q' }, d)
    expect(snapshot).toMatchObject({ status: 'empty', locationPending: true })
    expect(snapshot.items).toBeUndefined()
  })

  it.each(['auth', 'payment', 'rate_limit', 'invalid', 'unavailable', 'misconfigured'] as const)(
    'keeps the charge and maps a post-reserve %s failure without rows',
    async kind => {
      const d = deps({ search: vi.fn().mockRejectedValue(new DataForSeoError(kind, 500, 'vendor')) })
      const snapshot = await queryStudioDfs({ accountId: 'a', clientId: 'c', keyword: 'q' }, d)
      expect(snapshot).toMatchObject({ status: kind, week: { remaining: 19 }, locationPending: true })
      expect(snapshot.items).toBeUndefined()
      expect(d.reserve).toHaveBeenCalledTimes(1)
      expect(d.search).toHaveBeenCalledTimes(1)
    },
  )
})
