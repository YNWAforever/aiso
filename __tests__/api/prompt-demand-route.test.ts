import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ access: { ok: true, accountId: 'acc-1' } as unknown, input: null as unknown, fail: false, calls: [] as unknown[][] }))
vi.mock('@/lib/prompts/guard', () => ({ authorizePromptBank: vi.fn(async () => m.access) }))
vi.mock('@/lib/prompts/demand-store', () => ({ readDemandInputs: vi.fn(async (...args: unknown[]) => {
  m.calls.push(args); if (m.fail) throw new Error('boom'); return m.input }) }))

import { GET } from '@/app/api/dashboard/clients/[clientId]/prompts/demand/route'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const call = (clientId = CLIENT) => GET(new Request('http://localhost'), { params: Promise.resolve({ clientId }) })
const base = { brandName: 'Acme Dental', domain: 'acmedental.hk', activeCount: 8, questions: [] as string[] }

beforeEach(() => {
  m.access = { ok: true, accountId: 'acc-1' }; m.fail = false; m.calls.length = 0
  m.input = { state: 'ok', ...base, window: { start: '2026-10-07', end: '2026-11-03' },
    queries: [{ query: 'acme dental', clicks: 50, impressions: 900, position: 1 }, { query: 'teeth whitening', clicks: 4, impressions: 120, position: 8.5 },
      { query: 'braces', clicks: 2, impressions: 80, position: 12 }, { query: 'implants', clicks: 1, impressions: 60, position: null }] }
  process.env.FEATURE_SEARCH_CONSOLE = '1'
})
afterEach(() => { delete process.env.FEATURE_SEARCH_CONSOLE })

describe('GET /prompts/demand', () => {
  it('returns the guard response untouched and reads nothing', async () => {
    m.access = { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) }
    expect((await call()).status).toBe(403)
    expect(m.calls).toHaveLength(0)
  })

  it('404s a malformed id before any read, and a brand that is not the caller\'s', async () => {
    expect((await call('nope')).status).toBe(404)
    expect(m.calls).toHaveLength(0)
    m.input = { state: 'not_found' }
    expect((await call()).status).toBe(404)
  })

  it('reads with the session account, never a caller-supplied one', async () => {
    await call()
    expect(m.calls[0]).toEqual(['acc-1', CLIENT])
  })

  it('answers not_connected without a binding or with the feature off, never "no demand"', async () => {
    m.input = { state: 'not_connected', ...base }
    expect(await (await call()).json()).toEqual({ state: 'not_connected', activeCount: 8, activeLimit: 10 })
    m.input = { state: 'ok', ...base, queries: [{ query: 'braces', clicks: 1, impressions: 5, position: 3 }], window: null }
    delete process.env.FEATURE_SEARCH_CONSOLE
    expect((await (await call()).json()).state).toBe('not_connected')
  })

  it('answers no_data when the binding has no synced queries yet', async () => {
    m.input = { state: 'ok', ...base, queries: [], window: null }
    expect(await (await call()).json()).toEqual({ state: 'no_data', window: null, activeCount: 8, activeLimit: 10 })
  })

  it('returns drafts with their sources, the window and a CSV that only fills free slots', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({ state: 'ok', window: { start: '2026-10-07', end: '2026-11-03' }, activeCount: 8, activeLimit: 10, excludedBranded: 1 })
    expect(body.rows.map((r: { is_active: boolean }) => r.is_active)).toEqual([true, true, false])
    expect(body.sources[0]).toEqual({ query: 'teeth whitening', clicks: 4, impressions: 120, position: 8.5, language: 'en' })
    expect(body.csv.split('\n')).toHaveLength(4)
  })

  it('503s a failed read instead of reading as not connected', async () => {
    m.fail = true
    const res = await call()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'DEMAND_UNAVAILABLE' })
  })
})
