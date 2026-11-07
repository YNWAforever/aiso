import 'server-only'
import { db } from '@/lib/db'
import { loadReportBranding } from '@/lib/reports/store'
import type { ReportLocale } from '@/lib/reports/types'
import type { BrandMonthPeriod } from '@/lib/brand-month/period'
import { readBrandMonth } from '@/lib/brand-month/store'
import { buildMonthlyReportSnapshot, normalizeNarrative } from './snapshot'
import { appendMonthlyReport, createMonthlyReport, loadMonthlyReport, loadOpenWorkItems, MonthlyReportExistsError } from './store'

export type DraftResult =
  | { state: 'not_found' }
  | { state: 'branding_required' }
  | { state: 'invalid_narrative' }
  | { state: 'ok'; reportId: string; versionNumber: number }

export const monthLabel = (locale: ReportLocale, period: BrandMonthPeriod) =>
  new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${period.month}T00:00:00Z`))

/**
 * Saves a draft of the brand's monthly report: the month's first draft creates
 * the report, every later one appends a version (098's RPCs, which re-check
 * tenancy and kind). The snapshot is rebuilt from stored rows each time. An
 * omitted narrative keeps the previous draft's, or starts from the default.
 */
export async function draftMonthlyReport(input: {
  accountId: string; clientId: string; actorId: string; period: BrandMonthPeriod; locale: ReportLocale; narrative?: string | null; now: Date
}): Promise<DraftResult> {
  const { accountId, clientId, period, locale } = input
  const [client] = await db()`select brand_name, domain from clients where id = ${clientId}::uuid and account_id = ${accountId}::uuid`
  if (!client) return { state: 'not_found' }
  const month = await readBrandMonth(accountId, clientId, period)
  if (month.state === 'not_found') return { state: 'not_found' }
  const branding = await loadReportBranding({ accountId })
  if (!branding) return { state: 'branding_required' }
  let narrative: string | null = null
  if (input.narrative !== undefined && input.narrative !== null) {
    narrative = normalizeNarrative(input.narrative)
    if (!narrative) return { state: 'invalid_narrative' }
  }
  const existing = await loadMonthlyReport(accountId, clientId, period.month)
  if (narrative === null && existing) narrative = existing.snapshot.executiveSummary
  const snapshot = buildMonthlyReportSnapshot({
    locale, period, monthLabel: monthLabel(locale, period), branding,
    client: { name: String(client.brand_name ?? client.domain ?? ''), domain: String(client.domain ?? '') },
    activity: month.activity, snapshots: month.snapshots, openWorkItems: await loadOpenWorkItems(accountId, clientId),
    narrative, now: input.now,
  })
  const write = { accountId, clientId, locale, narrative: snapshot.executiveSummary, snapshot, actorId: input.actorId }
  if (existing) return { state: 'ok', ...await appendMonthlyReport({ ...write, reportId: existing.reportId }) }
  try {
    return { state: 'ok', ...await createMonthlyReport({ ...write, month: period.month }) }
  } catch (error) {
    // Another member saved the first draft a moment earlier: become its next version.
    if (!(error instanceof MonthlyReportExistsError)) throw error
    const raced = await loadMonthlyReport(accountId, clientId, period.month)
    if (!raced) throw error
    return { state: 'ok', ...await appendMonthlyReport({ ...write, reportId: raced.reportId }) }
  }
}
