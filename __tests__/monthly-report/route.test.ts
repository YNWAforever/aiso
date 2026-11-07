import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({ profile: null as unknown, draft: vi.fn(), load: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn(async () => m.profile) }))
vi.mock('@/lib/monthly-report/service', () => ({ draftMonthlyReport: m.draft }))
vi.mock('@/lib/monthly-report/store', () => ({ loadMonthlyReport: m.load }))

import { GET, POST } from '@/app/api/clients/[clientId]/months/[month]/report/route'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const ctx = (month = '2026-11', clientId = CLIENT) => ({ params: Promise.resolve({ clientId, month }) })
const post = (body: unknown, month?: string) => POST(new Request('http://localhost', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), ctx(month))
const profile = (plan: string) => ({ id: 'u1', account_id: 'acc-1', accounts: { plan, status: 'active', stripe_subscription_id: 'sub_1' } })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-05T00:00:00Z'))
  m.profile = profile('pro'); m.draft.mockReset(); m.draft.mockResolvedValue({ state: 'ok', reportId: 'r1', versionNumber: 3 })
  m.load.mockReset(); m.load.mockResolvedValue(null)
})
afterEach(() => { vi.useRealTimers() })

describe('/api/clients/[clientId]/months/[month]/report', () => {
  it('gates on session, then client reports, then a valid month, before any read or write', async () => {
    m.profile = null
    expect((await post({ locale: 'en' })).status).toBe(401)
    m.profile = profile('free')
    expect((await post({ locale: 'en' })).status).toBe(403)
    m.profile = profile('pro')
    expect((await post({ locale: 'en' }, '2027-01')).status).toBe(404)
    expect((await GET(new Request('http://localhost'), ctx('2026-11', 'nope'))).status).toBe(404)
    expect(m.draft).not.toHaveBeenCalled(); expect(m.load).not.toHaveBeenCalled()
  })

  it('refuses an unknown key, a wrong locale, a non-string narrative or a non-object body', async () => {
    for (const body of [{ locale: 'en', status: 'published' }, { locale: 'fr' }, { locale: 'en', narrative: 5 }, [], 'not json']) {
      expect((await post(body)).status).toBe(400)
    }
    expect(m.draft).not.toHaveBeenCalled()
  })

  it('saves a draft with the session account and answers 201', async () => {
    const res = await post({ locale: 'zh-HK', narrative: 'Hello' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ reportId: 'r1', versionNumber: 3 })
    expect(m.draft.mock.calls[0][0]).toMatchObject({ accountId: 'acc-1', clientId: CLIENT, actorId: 'u1', locale: 'zh-HK', narrative: 'Hello' })
  })

  it('maps each refusal, and never answers 2xx over a failed write', async () => {
    for (const [state, status] of [['not_found', 404], ['branding_required', 409], ['invalid_narrative', 400]] as const) {
      m.draft.mockResolvedValueOnce({ state })
      expect((await post({ locale: 'en' })).status).toBe(status)
    }
    m.draft.mockRejectedValueOnce(new Error('db'))
    expect((await post({ locale: 'en' })).status).toBe(503)
    m.load.mockRejectedValueOnce(new Error('db'))
    expect((await GET(new Request('http://localhost'), ctx())).status).toBe(503)
  })
})
