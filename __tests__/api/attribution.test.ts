import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The route through its REAL guard and service; only the session and the store
 * are mocked. Gates in order (flag → session → plan → id shape → ownership),
 * then the mapping from stored rows to the spec §5.2 shape.
 */
const getProfile = vi.hoisted(() => vi.fn())
const store = vi.hoisted(() => ({ loadOwnedVersion: vi.fn(), loadAttributionInput: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/attribution/store', () => store)

import { GET } from '@/app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/attribution/route'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const CLIENT = '22222222-2222-4222-8222-222222222222'
const ITEM = '33333333-3333-4333-8333-333333333333'
const VERSION = '44444444-4444-4444-8444-444444444444'
const ATTEST = '55555555-5555-4555-8555-555555555555'
const ASSET = '66666666-6666-4666-8666-666666666666'

const pro = { id: 'p', account_id: ACCOUNT, accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }
const params = (over: Record<string, string> = {}) =>
  ({ params: Promise.resolve({ clientId: CLIENT, workItemId: ITEM, versionId: VERSION, ...over }) })
const call = (over: Record<string, string> = {}) => GET(new Request('https://app.test/x'), params(over))

// 2026-09-11T16:30Z is 00:30 HKT on 12 Sep: D = 2026-09-12, before 08-15..09-11,
// after 09-13..10-10, ready on 10-13. "Now" is 20 Oct in Hong Kong.
const NOW = new Date('2026-10-20T04:00:00Z')
const WINDOWS = { before: { from: '2026-08-15', to: '2026-09-11' }, after: { from: '2026-09-13', to: '2026-10-10' } }
const attestation = { id: ATTEST, deliveredAt: '2026-09-11T16:30:00.000000Z', withdrawn: false }
const page = { scope: 'page' as const, asset: { id: ASSET, url: 'https://example.com/a', label: 'Page A' } }
const site = { scope: 'site' as const, asset: null }
const search = { boundAt: '2026-06-01T00:00:00.000Z', okRunDates: ['2026-10-15'], latestOutcome: 'ok' }
const searchDays = [
  { scope: 'page', pageUrl: 'https://example.com/a', date: '2026-09-01', clicks: 10, impressions: 100, position: 5 },
  { scope: 'page', pageUrl: 'https://example.com/a', date: '2026-09-20', clicks: 20, impressions: 100, position: 4 },
  // Another page's rows and the property's must never reach the page target.
  { scope: 'page', pageUrl: 'https://example.com/b', date: '2026-09-20', clicks: 999, impressions: 999, position: 1 },
  { scope: 'property', pageUrl: null, date: '2026-09-01', clicks: 30, impressions: 300, position: 6 },
  { scope: 'property', pageUrl: null, date: '2026-09-20', clicks: 60, impressions: 300, position: 3 },
]
const coverage = [
  { scope: 'page', pageUrl: 'https://example.com/a', coveredFrom: '2026-06-01' },
  { scope: 'property', pageUrl: null, coveredFrom: '2026-06-01' },
]
const input = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  attestation,
  measures: [page],
  sources: { search, coverage, searchDays, enquiries: null },
  ...over,
})

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  process.env.FEATURE_ATTRIBUTION = '1'
  process.env.FEATURE_SEARCH_CONSOLE = '1'
  delete process.env.FEATURE_ANALYTICS
  getProfile.mockReset().mockResolvedValue(pro)
  store.loadOwnedVersion.mockReset().mockResolvedValue(true)
  store.loadAttributionInput.mockReset().mockResolvedValue(input())
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.FEATURE_ATTRIBUTION
  delete process.env.FEATURE_SEARCH_CONSOLE
  delete process.env.FEATURE_ANALYTICS
  vi.restoreAllMocks()
})

describe('gates, in order', () => {
  it('is a plain 404 with the attribution flag off, before the session is read', async () => {
    process.env.FEATURE_ATTRIBUTION = '0'
    expect((await call()).status).toBe(404)
    expect(getProfile).not.toHaveBeenCalled()
  })

  it('is a 404 with the Search Console flag off, even with the attribution flag on', async () => {
    delete process.env.FEATURE_SEARCH_CONSOLE
    expect((await call()).status).toBe(404)
    expect(getProfile).not.toHaveBeenCalled()
  })

  it('is 401 without a session', async () => {
    getProfile.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(store.loadOwnedVersion).not.toHaveBeenCalled()
  })

  it.each([
    ['below Pro', { plan: 'basic' }],
    ['a cancelled Pro account', { status: 'cancelled' }],
  ])('is 403 UPGRADE_REQUIRED %s, before any lookup', async (_label, over) => {
    getProfile.mockResolvedValue({ ...pro, accounts: { ...pro.accounts, ...over } })
    const res = await call()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'UPGRADE_REQUIRED' })
    expect(store.loadOwnedVersion).not.toHaveBeenCalled()
  })

  it.each(['clientId', 'workItemId', 'versionId'])('is 404 for a malformed %s, before any query', async key => {
    expect((await call({ [key]: 'not-a-uuid' })).status).toBe(404)
    expect(store.loadOwnedVersion).not.toHaveBeenCalled()
  })

  it('is 404 for a version that is not in the session account', async () => {
    store.loadOwnedVersion.mockResolvedValue(false)
    expect((await call()).status).toBe(404)
    expect(store.loadAttributionInput).not.toHaveBeenCalled()
  })

  it('checks ownership with the session account, never a caller id', async () => {
    await call()
    expect(store.loadOwnedVersion).toHaveBeenCalledWith(ACCOUNT, CLIENT, ITEM, VERSION)
    expect(store.loadAttributionInput).toHaveBeenCalledWith(ACCOUNT, CLIENT, ITEM, VERSION, { analytics: false })
  })

  it('is 503 when the ownership lookup fails, never 404, logging the error name only', async () => {
    const err = new Error('postgresql://aeo_app:secret@host/db')
    err.name = 'NeonDbError'
    store.loadOwnedVersion.mockRejectedValue(err)
    const res = await call()
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(body).not.toContain('secret')
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).toContain('NeonDbError')
    expect(logged).not.toContain('secret')
    expect(logged).not.toContain('postgresql')
  })
})

describe('reads', () => {
  it('is 503 when the store throws, with no driver text in the body or the log', async () => {
    const err = new Error('postgresql://aeo_app:secret@host/db relation does not exist')
    err.name = 'NeonDbError'
    store.loadAttributionInput.mockRejectedValue(err)
    const res = await call()
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(body).not.toContain('secret')
    expect(body).not.toContain('relation')
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).toContain('NeonDbError')
    expect(logged).not.toContain('secret')
    expect(logged).not.toContain('relation')
  })

  it('is 404 when the version disappears between the guard and the read', async () => {
    store.loadAttributionInput.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('is private and never cached', async () => {
    expect((await call()).headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('GET maps the stored state', () => {
  it('maps a comparable page target, reading only that page\'s rows and coverage', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      deliveredOn: '2026-09-12',
      windows: WINDOWS,
      readyOn: '2026-10-13',
      targets: [{
        scope: 'page',
        asset: { id: ASSET, url: 'https://example.com/a', label: 'Page A' },
        status: 'comparable',
        search: {
          clicks: { before: 10, after: 20, change: 10, changePct: 1 },
          impressions: { before: 100, after: 100, change: 0, changePct: 0 },
          ctr: { before: 0.1, after: 0.2, change: 0.1, changePct: null },
          position: { before: 5, after: 4, change: -1, changePct: null },
        },
      }],
    })
  })

  it('reads a page\'s coverage, not the property\'s: an uncovered page is insufficient_history', async () => {
    store.loadAttributionInput.mockResolvedValue(input({
      sources: { search, coverage: [coverage[1]], searchDays, enquiries: null },
    }))
    const body = await (await call()).json()
    expect(body.targets[0]).toMatchObject({
      status: 'insufficient_history', missingFrom: '2026-08-15', missingTo: '2026-09-11',
    })
    expect(body.targets[0].search).toBeUndefined()
  })

  it('maps a site target with enquiries when analytics is enabled and entitled', async () => {
    process.env.FEATURE_ANALYTICS = '1'
    store.loadAttributionInput.mockResolvedValue(input({
      measures: [site],
      sources: {
        search, coverage, searchDays,
        enquiries: {
          state: { boundAt: '2026-06-01T00:00:00.000Z', coveredFrom: '2026-06-02', okRunDates: ['2026-10-15'], latestOutcome: 'ok' },
          days: [
            { date: '2026-09-01', sourceClass: 'ai_assistant', count: 2 },
            { date: '2026-09-20', sourceClass: 'ai_assistant', count: 5 },
            { date: '2026-09-21', sourceClass: 'organic_search', count: 3 },
          ],
        },
      },
    }))
    const res = await call()
    expect(store.loadAttributionInput).toHaveBeenCalledWith(ACCOUNT, CLIENT, ITEM, VERSION, { analytics: true })
    const body = await res.json()
    expect(body.targets).toEqual([{
      scope: 'site',
      status: 'comparable',
      search: {
        clicks: { before: 30, after: 60, change: 30, changePct: 1 },
        impressions: { before: 300, after: 300, change: 0, changePct: 0 },
        ctr: { before: 0.1, after: 0.2, change: 0.1, changePct: null },
        position: { before: 6, after: 3, change: -3, changePct: null },
      },
      enquiries: {
        status: 'comparable',
        total: { before: 2, after: 8, change: 6, changePct: 3 },
        organic_search: { before: 0, after: 3, change: 3, changePct: 'new' },
        ai_assistant: { before: 2, after: 5, change: 3, changePct: 1.5 },
        other: { before: 0, after: 0, change: 0, changePct: 0 },
      },
    }])
  })

  it('passes enquiries as not enabled (never null) for a site target with analytics off', async () => {
    store.loadAttributionInput.mockResolvedValue(input({ measures: [site] }))
    const body = await (await call()).json()
    expect(store.loadAttributionInput).toHaveBeenCalledWith(ACCOUNT, CLIENT, ITEM, VERSION, { analytics: false })
    expect(body.targets[0].status).toBe('comparable')
    expect(body.targets[0].enquiries).toEqual({ status: 'unavailable', reason: 'not_enabled' })
  })

  it('reads an unbound GA4 brand as not_bound, not as not_enabled, with analytics on', async () => {
    process.env.FEATURE_ANALYTICS = '1'
    store.loadAttributionInput.mockResolvedValue(input({
      measures: [site], sources: { search, coverage, searchDays, enquiries: { state: null, days: [] } },
    }))
    const body = await (await call()).json()
    expect(body.targets[0].enquiries).toEqual({ status: 'unavailable', reason: 'not_bound' })
  })

  it('is 503, not a quiet not_enabled, if analytics is on but the store skipped the GA4 read', async () => {
    // A forgotten input must never masquerade as "not enabled" (compareTarget
    // reads a null enquiries input that way).
    process.env.FEATURE_ANALYTICS = '1'
    store.loadAttributionInput.mockResolvedValue(input({ measures: [site] }))
    expect((await call()).status).toBe(503)
  })

  it('maps an unbound Search Console brand to unavailable / not_bound', async () => {
    store.loadAttributionInput.mockResolvedValue(input({
      sources: { search: null, coverage: [], searchDays: [], enquiries: null },
    }))
    const body = await (await call()).json()
    expect(body.targets[0]).toEqual({ scope: 'page', asset: page.asset, status: 'unavailable', reason: 'not_bound' })
  })

  it('maps a withdrawn attestation: no delivery date, every target withdrawn, no figures', async () => {
    store.loadAttributionInput.mockResolvedValue(input({
      attestation: { ...attestation, withdrawn: true }, measures: [page, site], sources: null,
    }))
    expect(await (await call()).json()).toEqual({
      deliveredOn: null, windows: null, readyOn: null,
      targets: [
        { scope: 'page', asset: page.asset, status: 'withdrawn' },
        { scope: 'site', status: 'withdrawn' },
      ],
    })
  })

  it('maps a version with no attestation to the empty shape', async () => {
    store.loadAttributionInput.mockResolvedValue(input({ attestation: null, measures: [], sources: null }))
    expect(await (await call()).json()).toEqual({ deliveredOn: null, windows: null, readyOn: null, targets: [] })
  })

  it('maps an attestation that measured nothing to one not_measured row', async () => {
    store.loadAttributionInput.mockResolvedValue(input({ measures: [], sources: null }))
    expect(await (await call()).json()).toEqual({
      deliveredOn: '2026-09-12', windows: WINDOWS, readyOn: '2026-10-13',
      targets: [{ scope: null, status: 'not_measured' }],
    })
  })

  it('maps a multi-source version to not_supported', async () => {
    store.loadAttributionInput.mockResolvedValue(input({ schemaVersion: 2, sources: null }))
    const body = await (await call()).json()
    expect(body.targets).toEqual([{ scope: 'page', asset: page.asset, status: 'not_supported' }])
  })

  it('withdraw then re-attest shows only the new attestation\'s measures (Review Focus 4)', async () => {
    // The store returns the latest attestation's measures only (its SQL shape is
    // pinned in attribution-store.test.ts and proven on Postgres in Task 7); the
    // service must render exactly those, under the new attestation's date.
    const reattested = { id: '77777777-7777-4777-8777-777777777777', deliveredAt: '2026-09-11T16:30:00.000000Z', withdrawn: false }
    store.loadAttributionInput.mockResolvedValue(input({ attestation: reattested, measures: [site] }))
    const body = await (await call()).json()
    expect(body.deliveredOn).toBe('2026-09-12')
    expect(body.targets.map((t: { scope: string }) => t.scope)).toEqual(['site'])
  })

  it('carries readyOn on a not_ready target before D+31', async () => {
    vi.setSystemTime(new Date('2026-10-01T04:00:00Z'))
    const body = await (await call()).json()
    expect(body.targets[0]).toEqual({ scope: 'page', asset: page.asset, status: 'not_ready', readyOn: '2026-10-13' })
  })
})
