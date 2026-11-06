import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ profile: null as unknown, month: null as unknown, record: null as unknown, fail: false, calls: [] as unknown[][] }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn(async () => m.profile) }))
vi.mock('@/lib/brand-month/store', () => ({
  readBrandMonth: vi.fn(async (...a: unknown[]) => { m.calls.push(['read', ...a]); if (m.fail) throw new Error('boom'); return m.month }),
  recordDueSnapshots: vi.fn(async (...a: unknown[]) => { m.calls.push(['record', ...a]); if (m.fail) throw new Error('boom'); return m.record }),
}))

import { GET, POST } from '@/app/api/clients/[clientId]/months/[month]/route'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const ctx = (month = '2026-11', clientId = CLIENT) => ({ params: Promise.resolve({ clientId, month }) })
const get = (month?: string, clientId?: string) => GET(new Request('http://localhost'), ctx(month, clientId))
const post = (month?: string) => POST(new Request('http://localhost', { method: 'POST' }), ctx(month))
const profile = (plan: string) => ({ id: 'u1', account_id: 'acc-1', accounts: { plan, status: 'active', stripe_subscription_id: 'sub_1' } })
const ACTIVITY = { workItemsOpened: 1, workItemsDone: 0, siteEditsSent: 0, receiptsCompleted: 0, receiptsRejected: 0, verifiedLive: [], selfReported: [] }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-05T00:00:00Z'))
  m.profile = profile('pro'); m.fail = false; m.calls.length = 0
  m.month = { state: 'ok', brandName: 'Bakery', activity: ACTIVITY, snapshots: [{ kind: 'opening', asOf: '2026-10-31T16:00:00.000Z', takenAt: 'x', figures: {} }] }
  m.record = { state: 'ok', recorded: ['closing'] }
})
afterEach(() => { vi.useRealTimers() })

describe('/api/clients/[clientId]/months/[month]', () => {
  it('401s without a session and 403s a plan without client reports, before any read', async () => {
    m.profile = null
    expect((await get()).status).toBe(401)
    m.profile = profile('free')
    expect((await get()).status).toBe(403)
    expect((await post()).status).toBe(403)
    expect(m.calls).toHaveLength(0)
  })

  it('404s a malformed id, a malformed month, a month not started and one past the lookback, before any read', async () => {
    for (const [month, id] of [['2026-11', 'nope'], ['2026-13', CLIENT], ['2027-01', CLIENT], ['2025-11', CLIENT]] as const) {
      expect((await get(month, id)).status).toBe(404)
    }
    expect(m.calls).toHaveLength(0)
    expect((await get('2025-12')).status).toBe(200)
  })

  it('reads with the session account and lists a due snapshot that is not recorded as pending', async () => {
    const res = await get()
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ period: { key: '2026-11', month: '2026-11-01', start: '2026-10-31T16:00:00.000Z', end: '2026-11-30T16:00:00.000Z' },
      brandName: 'Bakery', snapshots: (m.month as { snapshots: unknown }).snapshots, pending: ['closing'], activity: ACTIVITY })
    expect(m.calls[0].slice(0, 3)).toEqual(['read', 'acc-1', CLIENT])
  })

  it('404s a brand that is not the caller\'s', async () => {
    m.month = { state: 'not_found' }; m.record = { state: 'not_found' }
    expect((await get()).status).toBe(404)
    expect((await post()).status).toBe(404)
  })

  it('answers 201 when a snapshot was recorded and 200 when nothing was due', async () => {
    const res = await post()
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ recorded: ['closing'] })
    expect(m.calls[0].slice(0, 3)).toEqual(['record', 'acc-1', CLIENT])
    m.record = { state: 'ok', recorded: [] }
    expect((await post()).status).toBe(200)
  })

  it('503s a failed read or write rather than reporting success', async () => {
    m.fail = true
    expect((await get()).status).toBe(503)
    expect((await post()).status).toBe(503)
  })
})
