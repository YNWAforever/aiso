import 'server-only'

import { verifyReportShare } from '@/lib/reports/share'
import { resolvePublicClientReport } from '@/lib/reports/store'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { parseMonthlyReportSnapshot, type MonthlyReportSnapshotV2 } from './snapshot'

/**
 * The public, branded copy of a published monthly report. Built field by
 * field from the stored snapshot, so nothing outside this allow-list can reach
 * the page: raw branding URLs and internal version ids stay server-side.
 */
export type PublicMonthlyReport = Omit<MonthlyReportSnapshotV2, 'delivered' | 'branding'> & {
  branding: { agencyName: string; primaryColor: string; contactLabel: string | null; attribution: 'Powered by Fimmick AISO' }
  delivered: { verifiedLive: { title: string; recordedAt: string; versionId: string }[]; selfReported: { title: string; recordedAt: string; versionId: string }[] }
}

export type ResolvedPublishedMonthlyReport = Readonly<{ report: PublicMonthlyReport; publishedAt: string }>

function parseShareVersion(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= 2_147_483_647 ? parsed : null
}

const validTimestamp = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))

function unavailable(reason: 'lookup' | 'state' | 'snapshot' | 'entitlement'): null {
  console.warn('[public-monthly-report] unavailable', { reason })
  return null
}

const item = (d: { title: string; recordedAt: string }, i: number) => ({ title: d.title, recordedAt: d.recordedAt, versionId: String(i) })

function copySearch(s: MonthlyReportSnapshotV2['search']['opening']): MonthlyReportSnapshotV2['search']['opening'] {
  if (s.state === 'ok') return { state: 'ok', from: s.from, through: s.through, days: s.days, clicks: s.clicks, impressions: s.impressions }
  if (s.state === 'none') return { state: 'none', from: s.from, through: s.through }
  return { state: s.state }
}

function copyPublished(s: MonthlyReportSnapshotV2): PublicMonthlyReport {
  return {
    snapshotSchemaVersion: 2, kind: 'monthly', locale: s.locale, month: s.month,
    period: { start: s.period.start, end: s.period.end },
    branding: { agencyName: s.branding.agencyName, primaryColor: s.branding.primaryColor, contactLabel: s.branding.contactLabel, attribution: 'Powered by Fimmick AISO' },
    client: { name: s.client.name, domain: s.client.domain },
    // Version ids are internal; the public list is keyed by position instead.
    delivered: { verifiedLive: s.delivered.verifiedLive.map(item), selfReported: s.delivered.selfReported.map(item) },
    visibility: { state: 'not_enough_data', reason: 'movement_rule_pending' },
    search: { opening: copySearch(s.search.opening), closing: copySearch(s.search.closing) },
    nextMonth: { openWorkItems: s.nextMonth.openWorkItems.map(w => ({ title: w.title })) },
    executiveSummary: s.executiveSummary,
    builtAt: s.builtAt,
  }
}

/**
 * Resolves a share link to a published MONTHLY report, with the same checks,
 * in the same order, as the scan report's resolver (lib/reports/public.ts):
 * HMAC first (no database read for a bad signature), then a published
 * `kind = 'monthly'` row at this slug and share version, the full report /
 * version / account tuple, the owner's entitlement, and a schema-2 snapshot
 * whose locale matches its version. Any miss is a neutral null (404).
 */
export async function resolvePublishedMonthlyReport(input: { readonly slug: unknown; readonly version: unknown; readonly signature: unknown }): Promise<ResolvedPublishedMonthlyReport | null> {
  const shareVersion = parseShareVersion(input.version)
  if (typeof input.slug !== 'string' || typeof input.signature !== 'string' || shareVersion === null) return null
  try {
    if (!verifyReportShare({ slug: input.slug, shareVersion, signature: input.signature })) return null
  } catch {
    return unavailable('state')
  }
  try {
    const stored = await resolvePublicClientReport({ publicSlug: input.slug, shareVersion, kind: 'monthly' })
    if (!stored) return null
    const { report, version, account } = stored
    if (
      report.status !== 'published' || report.public_slug !== input.slug || report.share_version !== shareVersion
      || !report.published_version_id || report.published_version_id !== version.id || !validTimestamp(report.published_at)
      || version.report_id !== report.id || version.account_id !== report.account_id || version.client_id !== report.client_id
      || (version.snapshot_schema_version as number) !== 2 || account.id !== report.account_id
    ) return unavailable('state')
    if (!resolveCommercialEntitlement(account).features.client_reports_online) return unavailable('entitlement')
    const parsed = parseMonthlyReportSnapshot(version.snapshot)
    if (!parsed || parsed.locale !== version.locale) return unavailable('snapshot')
    return { report: copyPublished(parsed), publishedAt: report.published_at }
  } catch {
    return unavailable('lookup')
  }
}
