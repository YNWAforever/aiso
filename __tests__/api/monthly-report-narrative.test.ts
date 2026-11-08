import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ profile: vi.fn(), load: vi.fn(), draft: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: h.profile }))
vi.mock('@/lib/monthly-report/store', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/monthly-report/store')>()
  return { ...actual, loadMonthlyReport: h.load }
})
vi.mock('@/lib/monthly-report/narrative', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/monthly-report/narrative')>(), draftMonthlyNarrative: h.draft,
}))

import { POST } from '@/app/api/clients/[clientId]/months/[month]/report/ai-narrative/route'

const clientId = '11111111-1111-4111-8111-111111111111'
const ctx = { params: Promise.resolve({ clientId, month: '2026-11' }) }
const request = (body: unknown = { locale: 'en' }) => new Request('http://localhost/fixture', { method: 'POST', body: JSON.stringify(body) })
const snapshot = {
  snapshotSchemaVersion: 2, kind: 'monthly', locale: 'en', month: '2026-11', period: { start: 'a', end: 'b' },
  branding: { agencyName: 'Fimmery', logoUrl: null, primaryColor: '#111827', contactLabel: null, contactUrl: null, attribution: 'Powered by Fimmick AISO' },
  client: { name: 'Bakery', domain: 'bakery.hk' }, delivered: { verifiedLive: [], selfReported: [] },
  visibility: { state: 'not_enough_data', reason: 'no_pulse_data' },
  search: { opening: { state: 'not_connected' }, closing: { state: 'not_recorded' } }, nextMonth: { openWorkItems: [] },
  executiveSummary: 'Current narrative.', builtAt: 'x',
}
const report = { reportId: 'r1', status: 'draft', publicSlug: 'p'.repeat(32), shareVersion: 1, publishedVersionId: null, publishedLocale: null,
  versionId: 'v1', versionNumber: 1, createdAt: '2026-12-01T00:00:00.000Z', snapshot }

beforeEach(() => {
  vi.clearAllMocks()
  h.profile.mockResolvedValue({ id: '20000000-0000-4000-8000-000000000001', account_id: 'acc',
    accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } })
  h.load.mockResolvedValue(report)
  h.draft.mockResolvedValue({ narrative: 'A polished sentence about the month.', polished: true, code: 'ai_polished' })
})

describe('POST monthly report ai-narrative', () => {
  it('returns wording for the operator and writes nothing', async () => {
    const response = await POST(request({ locale: 'zh-HK' }), ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ narrative: 'A polished sentence about the month.', polished: true, code: 'ai_polished' })
    expect(h.draft).toHaveBeenCalledWith(expect.objectContaining({ locale: 'zh-HK', month: '2026-11' }))
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('requires a saved draft, because AI wording never creates the first narrative', async () => {
    h.load.mockResolvedValue(null)
    const response = await POST(request(), ctx)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'DRAFT_REQUIRED' })
    expect(h.draft).not.toHaveBeenCalled()
  })

  it.each([
    [{}, 400], [{ locale: 'fr' }, 400], [{ locale: 'en', extra: true }, 400], [null, 400], ['en', 400],
  ])('rejects a malformed body (%j)', async (body, status) => {
    const response = POST(body === null ? new Request('http://localhost/fixture', { method: 'POST', body: 'null' }) : request(body), ctx)
    expect((await response).status).toBe(status)
    expect(h.draft).not.toHaveBeenCalled()
  })

  it('denies an unauthenticated caller and a plan without online reports before any model call', async () => {
    h.profile.mockResolvedValue(null)
    expect((await POST(request(), ctx)).status).toBe(401)
    h.profile.mockResolvedValue({ id: 'u', account_id: 'acc', accounts: { plan: 'free', status: 'active', stripe_subscription_id: null } })
    expect((await POST(request(), ctx)).status).toBe(403)
    expect(h.draft).not.toHaveBeenCalled()
  })

  it('fails closed when the stored report cannot be read', async () => {
    h.load.mockRejectedValue(new Error('PRIVATE_LEDGER_SENTINEL'))
    const response = await POST(request(), ctx)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('PRIVATE_')
  })

  it('refuses a month outside the drafting lookback', async () => {
    const response = await POST(request(), { params: Promise.resolve({ clientId, month: '2024-01' }) })
    expect(response.status).toBe(404)
  })
})
