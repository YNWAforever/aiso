import { hongKongMonthKey } from '@/lib/brand-month/period'
import type { MonthlyReportListItem } from './store'

/**
 * The month page and the monthly report share one Hong Kong calendar month. The
 * dashboard entry shows the *current* month's report only: showing last month's
 * status under "this month" would be a false claim, and a month with no saved
 * report has nothing to link to.
 */
export function currentMonthReport(rows: readonly MonthlyReportListItem[], now: Date = new Date()): MonthlyReportListItem | null {
  const key = hongKongMonthKey(now)
  return rows.find(row => row.month === key) ?? null
}
