import { describe, expect, it } from 'vitest'
import { currentMonthReport } from '@/lib/monthly-report/report-entry'
import type { MonthlyReportListItem } from '@/lib/monthly-report/store'

const row = (month: string, status: MonthlyReportListItem['status'] = 'draft'): MonthlyReportListItem => ({
  reportId: `r-${month}`, month, status, publicSlug: 'p'.repeat(32), shareVersion: 1,
  locale: 'en', versionId: `v-${month}`, versionNumber: 1, publishedVersionNumber: null, publishedLocale: null, publishedAt: null,
})

describe('currentMonthReport', () => {
  it('picks the report of the current Hong Kong month, not the newest row', () => {
    const now = new Date('2026-11-15T05:00:00Z')
    expect(currentMonthReport([row('2026-12'), row('2026-11', 'published'), row('2026-10')], now)?.month).toBe('2026-11')
  })

  it('treats a UTC instant late on the last day as the next Hong Kong month', () => {
    // 2026-11-30 17:00Z is 2026-12-01 01:00 in Hong Kong.
    expect(currentMonthReport([row('2026-11'), row('2026-12', 'draft')], new Date('2026-11-30T17:00:00Z'))?.month).toBe('2026-12')
  })

  it('returns null when this month has no saved report, so the dashboard shows no entry', () => {
    expect(currentMonthReport([row('2026-10')], new Date('2026-11-15T05:00:00Z'))).toBeNull()
    expect(currentMonthReport([], new Date('2026-11-15T05:00:00Z'))).toBeNull()
  })
})
