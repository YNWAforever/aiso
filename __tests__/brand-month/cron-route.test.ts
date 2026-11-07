import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ due: [] as unknown[], record: vi.fn(), runs: [] as unknown[][] }))
vi.mock('@/lib/cron/recordRun', () => ({ startCronRun: vi.fn(async () => 'run-1'), finishCronRun: vi.fn(async (...a: unknown[]) => { m.runs.push(a) }) }))
// Pages like the real query: ordered by client id, after the cursor, at most `limit`.
vi.mock('@/lib/brand-month/queue', () => ({ loadDueMonthBrands: vi.fn(async (_now: Date, limit: number, after: string | null = null) =>
  (m.due as { clientId: string }[]).filter(b => after === null || b.clientId > after).slice(0, limit)) }))
vi.mock('@/lib/brand-month/store', () => ({ recordDueSnapshots: m.record }))

import { GET } from '@/app/api/cron/brand-months/route'

const SECRET = 'cron-secret-of-sufficient-length'
const call = (auth: string | null = `Bearer ${SECRET}`) => GET(new Request('http://localhost/api/cron/brand-months', auth ? { headers: { authorization: auth } } : {}))
const brand = (clientId: string, plan: string) => ({ accountId: `acc-${clientId}`, clientId, account: { plan, status: 'active', stripe_subscription_id: 'sub_1' } })

beforeEach(() => {
  process.env.CRON_SECRET = SECRET; m.due = []; m.runs.length = 0
  m.record.mockReset(); m.record.mockResolvedValue({ state: 'ok', recorded: ['opening'] })
})
afterEach(() => { delete process.env.CRON_SECRET })

describe('GET /api/cron/brand-months', () => {
  it('refuses to run without a usable secret, and without the exact header', async () => {
    delete process.env.CRON_SECRET
    expect((await call()).status).toBe(500)
    process.env.CRON_SECRET = 'short'
    expect((await call()).status).toBe(500)
    process.env.CRON_SECRET = SECRET
    expect((await call(null)).status).toBe(401)
    expect((await call(`Bearer ${SECRET}x`)).status).toBe(401)
    expect(m.record).not.toHaveBeenCalled()
  })

  it('records due snapshots for entitled brands only, last month before this month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-05T00:00:00Z'))
    m.due = [brand('c1', 'pro'), brand('c2', 'free')]
    const res = await call()
    vi.useRealTimers()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ due: 1, recorded: 2, notEntitled: 1, failed: 0 })
    expect(m.record.mock.calls.map(c => [c[1], (c[2] as { key: string }).key])).toEqual([['c1', '2026-11'], ['c1', '2026-12']])
    expect(m.record.mock.calls[0][0]).toBe('acc-c1')
    expect(m.runs[0].slice(0, 2)).toEqual(['run-1', 'ok'])
  })

  it('pages past a full batch of brands it skips, so an entitled brand behind them is still recorded', async () => {
    m.due = [...Array.from({ length: 200 }, (_, i) => brand(`a${String(i).padStart(3, '0')}`, 'free')), brand('z-entitled', 'pro')]
    const res = await call()
    expect(await res.json()).toEqual({ due: 1, recorded: 2, notEntitled: 200, failed: 0 })
    expect(m.record.mock.calls.every(c => c[1] === 'z-entitled')).toBe(true)
  })

  it('answers 502 when every due brand failed, and 200 when only some did', async () => {
    m.due = [brand('c1', 'pro')]
    m.record.mockRejectedValue(new Error('db'))
    expect((await call()).status).toBe(502)
    expect(m.runs[0][1]).toBe('error')
    m.due = [brand('c1', 'pro'), brand('c2', 'pro')]
    m.record.mockReset()
    m.record.mockImplementation(async (_a: string, clientId: string) => { if (clientId === 'c1') throw new Error('db'); return { state: 'ok', recorded: [] } })
    expect(await (await call()).json()).toEqual({ due: 2, recorded: 0, notEntitled: 0, failed: 1 })
  })
})
