import 'server-only'
import { db } from '@/lib/db'
import { loadReportBranding } from '@/lib/reports/store'
import type { ReportLocale } from '@/lib/reports/types'
import type { BrandMonthPeriod } from '@/lib/brand-month/period'
import { readBrandMonth } from '@/lib/brand-month/store'
import { buildMonthlyReportSnapshot, normalizeNarrative } from './snapshot'
import { appendMonthlyReport, createMonthlyReport, loadMonthlyReport, loadOpenWorkItems, MonthlyReportExistsError, publishMonthlyReport, revokeMonthlyReport } from './store'
import { buildReportShareUrl } from '@/lib/reports/share'
import { appOrigin } from '@/lib/app-origin'

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

export type PublishResult =
  | { state: 'not_found' } | { state: 'stale' }
  | { state: 'ok'; shareUrl: string; versionNumber: number }

/**
 * Publishes the draft the operator reviewed. 027's RPC refuses it when a newer
 * draft has been saved since ('reviewed version is stale'), so what goes out is
 * exactly what was looked at.
 */
export async function publishMonthly(input: { accountId: string; clientId: string; period: BrandMonthPeriod; reviewedVersionId: string }): Promise<PublishResult> {
  const report = await loadMonthlyReport(input.accountId, input.clientId, input.period.month)
  if (!report) return { state: 'not_found' }
  if (report.versionId !== input.reviewedVersionId) return { state: 'stale' }
  try {
    const published = await publishMonthlyReport({ accountId: input.accountId, clientId: input.clientId, reportId: report.reportId, reviewedVersionId: input.reviewedVersionId })
    return { state: 'ok', versionNumber: report.versionNumber,
      shareUrl: buildReportShareUrl({ origin: appOrigin(), locale: report.snapshot.locale, slug: published.publicSlug, shareVersion: published.shareVersion }) }
  } catch (error) {
    if (error instanceof Error && /reviewed version is stale/.test(error.message)) return { state: 'stale' }
    throw error
  }
}

export async function revokeMonthly(input: { accountId: string; clientId: string; period: BrandMonthPeriod }): Promise<{ state: 'not_found' } | { state: 'ok' }> {
  const report = await loadMonthlyReport(input.accountId, input.clientId, input.period.month)
  if (!report || report.status !== 'published') return { state: 'not_found' }
  await revokeMonthlyReport({ accountId: input.accountId, clientId: input.clientId, reportId: report.reportId })
  return { state: 'ok' }
}

/** The live share link for a published monthly report, or null. Built server-side; the signature never leaves the server otherwise. */
export function monthlyShareUrl(report: { status: string; publicSlug: string; shareVersion: number; publishedLocale: 'en' | 'zh-HK' | null }): string | null {
  return report.status === 'published' && report.publishedLocale
    ? buildReportShareUrl({ origin: appOrigin(), locale: report.publishedLocale, slug: report.publicSlug, shareVersion: report.shareVersion })
    : null
}
