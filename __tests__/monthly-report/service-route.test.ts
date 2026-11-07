import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  client: [{ brand_name: 'Bakery', domain: 'bakery.hk' }] as unknown[], month: null as unknown, branding: null as unknown,
  existing: null as unknown, create: vi.fn(), append: vi.fn(), load: vi.fn(), profile: null as unknown, draft: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => async () => m.client }))
vi.mock('@/lib/brand-month/store', () => ({ readBrandMonth: vi.fn(async () => m.month) }))
vi.mock('@/lib/reports/store', () => ({ loadReportBranding: vi.fn(async () => m.branding) }))
vi.mock('@/lib/monthly-report/store', async () => {
  class MonthlyReportExistsError extends Error {}
  return { MonthlyReportExistsError, loadMonthlyReport: m.load, createMonthlyReport: m.create, appendMonthlyReport: m.append,
    loadOpenWorkItems: vi.fn(async () => [{ title: 'Open item' }]) }
})
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn(async () => m.profile) }))

import { draftMonthlyReport } from '@/lib/monthly-report/service'
import { MonthlyReportExistsError } from '@/lib/monthly-report/store'
import { periodOf } from '@/lib/brand-month/period'

const period = periodOf('2026-11')!
const ACTIVITY = { workItemsOpened: 0, workItemsDone: 0, siteEditsSent: 0, receiptsCompleted: 0, receiptsRejected: 0, verifiedLive: [], selfReported: [] }
const input = (over: Record<string, unknown> = {}) => ({ accountId: 'acc', clientId: 'c', actorId: 'u', period, locale: 'en' as const, now: new Date('2026-12-04T00:00:00Z'), ...over })

beforeEach(() => {
  m.client = [{ brand_name: 'Bakery', domain: 'bakery.hk' }]
  m.month = { state: 'ok', brandName: 'Bakery', snapshots: [], activity: ACTIVITY }
  m.branding = { accountId: 'acc', agencyName: 'Fimmick', logoUrl: null, primaryColor: '#111827', contactLabel: null, contactUrl: null }
  m.load.mockReset(); m.load.mockResolvedValue(null)
  m.create.mockReset(); m.create.mockResolvedValue({ reportId: 'r1', versionNumber: 1 })
  m.append.mockReset(); m.append.mockResolvedValue({ reportId: 'r1', versionNumber: 2 })
})

describe('draftMonthlyReport', () => {
  it('creates the month\'s first draft from stored rows, with the default narrative', async () => {
    expect(await draftMonthlyReport(input())).toEqual({ state: 'ok', reportId: 'r1', versionNumber: 1 })
    const call = m.create.mock.calls[0][0]
    expect(call).toMatchObject({ accountId: 'acc', clientId: 'c', month: '2026-11-01', locale: 'en', actorId: 'u',
      narrative: 'November 2026: 0 changes verified live and 0 self-reported.' })
    expect(call.snapshot).toMatchObject({ kind: 'monthly', nextMonth: { openWorkItems: [{ title: 'Open item' }] } })
    expect(m.append).not.toHaveBeenCalled()
  })

  it('appends a version to an existing draft, keeping its narrative unless a new one is given', async () => {
    m.load.mockResolvedValue({ reportId: 'r1', snapshot: { executiveSummary: 'Kept narrative.' } })
    await draftMonthlyReport(input())
    expect(m.append.mock.calls[0][0]).toMatchObject({ reportId: 'r1', narrative: 'Kept narrative.' })
    await draftMonthlyReport(input({ narrative: 'New narrative.' }))
    expect(m.append.mock.calls[1][0]).toMatchObject({ narrative: 'New narrative.' })
    expect(m.create).not.toHaveBeenCalled()
  })

  it('becomes the next version when another member created the month a moment earlier', async () => {
    m.create.mockRejectedValue(new MonthlyReportExistsError())
    m.load.mockResolvedValueOnce(null).mockResolvedValueOnce({ reportId: 'r9', snapshot: { executiveSummary: 'x' } })
    expect(await draftMonthlyReport(input())).toEqual({ state: 'ok', reportId: 'r1', versionNumber: 2 })
    expect(m.append.mock.calls[0][0]).toMatchObject({ reportId: 'r9' })
  })

  it('answers not found, branding required and invalid narrative without writing', async () => {
    m.client = []
    expect(await draftMonthlyReport(input())).toEqual({ state: 'not_found' })
    m.client = [{ brand_name: 'Bakery', domain: 'bakery.hk' }]; m.branding = null
    expect(await draftMonthlyReport(input())).toEqual({ state: 'branding_required' })
    m.branding = { accountId: 'acc', agencyName: 'Fimmick', logoUrl: null, primaryColor: '#111827', contactLabel: null, contactUrl: null }
    expect(await draftMonthlyReport(input({ narrative: '   ' }))).toEqual({ state: 'invalid_narrative' })
    expect(m.create).not.toHaveBeenCalled(); expect(m.append).not.toHaveBeenCalled()
  })
})
