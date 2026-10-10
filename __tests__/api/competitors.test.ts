import { describe, it, expect, vi, beforeEach } from 'vitest'

type Call = { text: string; params: unknown[] }

const calls: Call[] = []
let ownedRows: unknown[]
let competitorRows: unknown[]
let lockedRows: unknown[]
let insertedRows: unknown[]
let updatedRows: unknown[]
let stateRows: unknown[]
let failOn: RegExp | null
let failWith: Error

// Dispatch on statement shape. The write routes run one transaction of
// lock -> sync array -> change -> mirror array (-> state), so each statement is
// told apart by what it does, not by position.
const mockSql = Object.assign(vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => {
  const text = strings.join('?')
  calls.push({ text, params })
  if (failOn && failOn.test(text)) return Promise.reject(failWith)
  if (/for no key update/i.test(text)) return Promise.resolve(lockedRows)
  if (/insert into competitors[\s\S]*unnest/i.test(text)) return Promise.resolve([])
  if (/insert into competitors/i.test(text)) return Promise.resolve(insertedRows)
  if (/update competitors/i.test(text)) return Promise.resolve(updatedRows)
  if (/update clients/i.test(text)) return Promise.resolve([])
  if (/name_taken/i.test(text)) return Promise.resolve(stateRows)
  if (/from competitors/i.test(text)) return Promise.resolve(competitorRows)
  if (/from clients\b/i.test(text)) return Promise.resolve(ownedRows)
  return Promise.resolve([])
}), { transaction: async (queries: Promise<unknown[]>[]) => Promise.all(queries) })

vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

import { GET, POST } from '@/app/api/dashboard/clients/[clientId]/competitors/route'
import { PATCH, DELETE } from '@/app/api/dashboard/clients/[clientId]/competitors/[competitorId]/route'
import { getProfile } from '@/lib/auth'

const profile = (plan = 'pro') => ({
  id: 'u1', account_id: 'acc-1',
  accounts: { plan, status: 'active', stripe_subscription_id: 'sub_1' },
})

const clientParams = { params: Promise.resolve({ clientId: 'client-1' }) }
const itemParams = { params: Promise.resolve({ clientId: 'client-1', competitorId: 'comp-1' }) }
const body = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value)

const get = () => GET(new Request('http://localhost'), clientParams)
const post = (value: unknown = { name: 'Acme', aliases: ['Acme Co'], domains: ['acme.com'] }) =>
  POST(new Request('http://localhost', { method: 'POST', body: body(value) }), clientParams)
const patch = (value: unknown = { aliases: ['AC'] }) =>
  PATCH(new Request('http://localhost', { method: 'PATCH', body: body(value) }), itemParams)
const del = () => DELETE(new Request('http://localhost', { method: 'DELETE' }), itemParams)

const ROW = {
  id: 'comp-1', name: 'Acme', aliases: ['Acme Co'], domains: ['acme.com'],
  created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z',
}

beforeEach(() => {
  calls.length = 0
  failOn = null
  failWith = new Error('boom')
  ownedRows = [{ id: 'client-1', competitors: ['Acme'] }]
  competitorRows = [ROW]
  lockedRows = [{ id: 'client-1' }]
  insertedRows = [ROW]
  updatedRows = [ROW]
  stateRows = [{ live_count: 1, name_taken: false }]
  vi.mocked(getProfile).mockReset()
  vi.mocked(getProfile).mockResolvedValue(profile() as never)
})

const ALL = [
  { name: 'GET', call: () => get() },
  { name: 'POST', call: () => post() },
  { name: 'PATCH', call: () => patch() },
  { name: 'DELETE', call: () => del() },
] as const

describe('competitors routes: gate', () => {
  it.each(ALL)('$name returns 401 and touches nothing when signed out', async ({ call }) => {
    vi.mocked(getProfile).mockResolvedValue(null as never)
    const res = await call()
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  // Competitors are set during onboarding on every plan; editing them is not a
  // paid capability. Cost is gated where it is spent, in Pulse.
  it('lets a free account edit its own competitors', async () => {
    vi.mocked(getProfile).mockResolvedValue(profile('free') as never)
    expect((await post()).status).toBe(201)
  })

  it.each(ALL)('$name scopes every statement to the session account', async ({ call }) => {
    await call()
    expect(calls.length).toBeGreaterThan(0)
    for (const statement of calls) {
      expect(statement.text).toMatch(/account_id/)
      expect(statement.params).toContain('acc-1')
    }
  })
})

describe('GET competitors', () => {
  it('returns table rows plus names that exist only in the legacy array', async () => {
    ownedRows = [{ id: 'client-1', competitors: ['acme', 'Globex'] }]
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ competitors: [
      ROW,
      { id: null, name: 'Globex', aliases: [], domains: [], created_at: null, updated_at: null },
    ] })
  })

  it('answers 404 for a client the account does not own', async () => {
    ownedRows = []
    expect((await get()).status).toBe(404)
  })

  it('answers 503, not 404, when the lookup fails', async () => {
    failOn = /from clients/
    expect((await get()).status).toBe(503)
  })
})

describe('POST competitors', () => {
  it('creates the competitor and mirrors live names back to the array in one transaction', async () => {
    const res = await post()
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ competitor: ROW })
    const order = calls.map(c => /for no key update/i.test(c.text) ? 'lock'
      : /insert into competitors[\s\S]*unnest/i.test(c.text) ? 'sync'
      : /insert into competitors/i.test(c.text) ? 'insert'
      : /update clients/i.test(c.text) ? 'mirror'
      : /name_taken/i.test(c.text) ? 'state' : 'other')
    expect(order).toEqual(['lock', 'sync', 'insert', 'mirror', 'state'])
    const insert = calls.find(c => /insert into competitors(?![\s\S]*unnest)/i.test(c.text))!
    expect(insert.params).toEqual(expect.arrayContaining(['Acme', ['Acme Co'], ['acme.com']]))
  })

  it.each([
    ['not json', 'Invalid JSON'],
    [{ name: '' }, 'name_required'],
    [{ name: 'Acme', domains: ['localhost'] }, 'invalid_domain'],
  ])('refuses %j with 400 before any query', async (value, error) => {
    const res = await post(value)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error })
    expect(calls).toHaveLength(0)
  })

  it('answers 404 when the client is not the account\'s', async () => {
    lockedRows = []
    expect((await post()).status).toBe(404)
  })

  it('answers 409 COMPETITOR_EXISTS for a live duplicate name', async () => {
    insertedRows = []
    stateRows = [{ live_count: 3, name_taken: true }]
    const res = await post()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'COMPETITOR_EXISTS' })
  })

  it('answers 409 COMPETITOR_LIMIT_REACHED when the brand is full', async () => {
    insertedRows = []
    stateRows = [{ live_count: 10, name_taken: false }]
    const res = await post()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'COMPETITOR_LIMIT_REACHED', max: 10 })
  })

  it('answers 500 rather than a success when the write fails', async () => {
    failOn = /insert into competitors(?![\s\S]*unnest)/i
    expect((await post()).status).toBe(500)
  })
})

describe('PATCH and DELETE a competitor', () => {
  it('updates only the fields sent', async () => {
    const res = await patch({ domains: ['https://www.acme.com/'] })
    expect(res.status).toBe(200)
    const update = calls.find(c => /update competitors/i.test(c.text))!
    expect(update.params).toEqual(expect.arrayContaining([['acme.com'], 'comp-1', 'client-1', 'acc-1']))
  })

  it('refuses an empty patch with 400 before any query', async () => {
    const res = await patch({})
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('answers 404 when nothing live matched', async () => {
    updatedRows = []
    expect((await patch()).status).toBe(404)
    expect((await del()).status).toBe(404)
  })

  it('answers 409 when a rename collides with a live competitor', async () => {
    failOn = /update competitors/i
    failWith = Object.assign(new Error('duplicate key'), { code: '23505' })
    const res = await patch({ name: 'Globex' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'COMPETITOR_EXISTS' })
  })

  it('archives rather than deletes, and mirrors the array', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(calls.some(c => /delete from competitors/i.test(c.text))).toBe(false)
    expect(calls.find(c => /update competitors/i.test(c.text))!.text).toMatch(/archived_at\s*=\s*now\(\)/i)
    expect(calls.some(c => /update clients/i.test(c.text))).toBe(true)
  })
})
