import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ getProfile: vi.fn(), listAssets: vi.fn(), loadSyncedPageIds: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: m.getProfile }))
vi.mock('@/lib/assets/store', () => ({ listAssets: m.listAssets }))
vi.mock('@/lib/attribution/store', () => ({ loadSyncedPageIds: m.loadSyncedPageIds }))

import { loadMeasureOptions } from '@/lib/attribution/options'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const pro = { account_id: 'acct-1', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }
const free = { account_id: 'acct-1', accounts: { plan: 'free', status: 'active', stripe_subscription_id: null } }
const assets = [
  { id: 'a1', url: 'https://example.com/a', origin: 'https://example.com', label: 'Alpha' },
  { id: 'a2', url: 'https://example.com/b', origin: 'https://example.com', label: 'Beta' },
]

describe('loadMeasureOptions', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    process.env.FEATURE_ATTRIBUTION = '1'
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    m.getProfile.mockReset().mockResolvedValue(pro)
    m.listAssets.mockReset().mockResolvedValue(assets)
    m.loadSyncedPageIds.mockReset().mockResolvedValue(['a1', 'a2'])
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    delete process.env.FEATURE_ATTRIBUTION
    delete process.env.FEATURE_SEARCH_CONSOLE
    vi.restoreAllMocks()
  })

  it('lists the session account\'s registered pages as id, url, label and whether Search Console syncs them', async () => {
    expect(await loadMeasureOptions(CLIENT)).toEqual({
      pages: [
        { id: 'a1', url: 'https://example.com/a', label: 'Alpha', synced: true },
        { id: 'a2', url: 'https://example.com/b', label: 'Beta', synced: true },
      ],
    })
    expect(m.listAssets).toHaveBeenCalledWith('acct-1', CLIENT)
    expect(m.loadSyncedPageIds).toHaveBeenCalledWith('acct-1', CLIENT)
  })

  it('marks a page outside the Search Console sync set as not synced, and keeps offering it', async () => {
    m.loadSyncedPageIds.mockResolvedValue(['a2'])
    expect((await loadMeasureOptions(CLIENT))!.pages).toEqual([
      { id: 'a1', url: 'https://example.com/a', label: 'Alpha', synced: false },
      { id: 'a2', url: 'https://example.com/b', label: 'Beta', synced: true },
    ])
  })

  it('returns an empty page list for a brand with no registered pages', async () => {
    m.listAssets.mockResolvedValue([])
    m.loadSyncedPageIds.mockResolvedValue([])
    expect(await loadMeasureOptions(CLIENT)).toEqual({ pages: [] })
  })

  it('is null, touching nothing, when the feature is off', async () => {
    delete process.env.FEATURE_ATTRIBUTION
    expect(await loadMeasureOptions(CLIENT)).toBeNull()
    expect(m.getProfile).not.toHaveBeenCalled()
    expect(m.listAssets).not.toHaveBeenCalled()
    expect(m.loadSyncedPageIds).not.toHaveBeenCalled()
  })

  it('is null without a session', async () => {
    m.getProfile.mockResolvedValue(null)
    expect(await loadMeasureOptions(CLIENT)).toBeNull()
    expect(m.listAssets).not.toHaveBeenCalled()
    expect(m.loadSyncedPageIds).not.toHaveBeenCalled()
  })

  it('is null when the plan does not grant search_console', async () => {
    m.getProfile.mockResolvedValue(free)
    expect(await loadMeasureOptions(CLIENT)).toBeNull()
    expect(m.listAssets).not.toHaveBeenCalled()
    expect(m.loadSyncedPageIds).not.toHaveBeenCalled()
  })

  it.each(['listAssets', 'loadSyncedPageIds'] as const)('is null when %s fails, and logs only the error name', async fn => {
    const failure = new Error('postgresql://user:secret@host/db')
    failure.name = 'NeonDbError'
    m[fn].mockRejectedValue(failure)
    expect(await loadMeasureOptions(CLIENT)).toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(errorSpy.mock.calls)).toContain('NeonDbError')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret')
  })
})
