import 'server-only'

import { verifyReportShare } from '@/lib/reports/share'
import { resolvePublicClientReport } from '@/lib/reports/store'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'
import { parseMonthlyReportSnapshot, type MonthlyReportSnapshotV2 } from './snapshot'
import { loadMonthlyReviewTarget, readMonthlyReviews, type MonthlyReview } from './store'
import { verifyReviewToken } from './review-token'

/**
 * The public, branded copy of a published monthly report. Built field by
 * field from the stored snapshot, so nothing outside this allow-list can reach
 * the page: raw branding URLs and internal version ids stay server-side.
 */
export type PublicMonthlyReport = Omit<MonthlyReportSnapshotV2, 'delivered' | 'branding'> & {
  branding: { agencyName: string; primaryColor: string; contactLabel: string | null; attribution: 'Powered by Fimmick AISO' }
  delivered: { verifiedLive: { title: string; recordedAt: string; versionId: string }[]; selfReported: { title: string; recordedAt: string; versionId: string }[] }
}

export type ResolvedPublishedMonthlyReport = Readonly<{
  report: PublicMonthlyReport
  publishedAt: string
  /**
   * Same-origin proxy URLs, built from the link's own signature. The raw
   * destinations are never part of this object — the page can only point at
   * routes that re-verify the link.
   */
  logoProxyUrl: string | null
  contactProxyUrl: string | null
}>

/** Raw branding destinations. Server-only: used by the proxy routes, never returned to a page. */
export type MonthlyReportAssets = Readonly<{ logoUrl: string | null; contactLabel: string | null; contactUrl: string | null }>

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

function copyVisibility(v: MonthlyReportSnapshotV2['visibility']): MonthlyReportSnapshotV2['visibility'] {  if (v.state === 'not_enough_data') return { state: 'not_enough_data', reason: v.reason }
  return { state: 'recorded', rule: v.rule, minAnswersPerWeek: v.minAnswersPerWeek, minDelta: v.minDelta,
    platforms: v.platforms.map(p => ({ platform: p.platform, opening: p.opening, closing: p.closing, delta: p.delta,
      direction: p.direction, reason: p.reason, weeks: p.weeks })) }
}

function copyPublished(s: MonthlyReportSnapshotV2): PublicMonthlyReport {
  return {
    snapshotSchemaVersion: 2, kind: 'monthly', locale: s.locale, month: s.month,
    period: { start: s.period.start, end: s.period.end },
    branding: { agencyName: s.branding.agencyName, primaryColor: s.branding.primaryColor, contactLabel: s.branding.contactLabel, attribution: 'Powered by Fimmick AISO' },
    client: { name: s.client.name, domain: s.client.domain },
    // Version ids are internal; the public list is keyed by position instead.
    delivered: { verifiedLive: s.delivered.verifiedLive.map(item), selfReported: s.delivered.selfReported.map(item) },
    visibility: copyVisibility(s.visibility),
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
function publicAssetUrl(asset: 'logo' | 'contact', slug: string, shareVersion: number, signature: string): string {
  const query = new URLSearchParams({ v: String(shareVersion), s: signature })
  return `/api/public/monthly-reports/${encodeURIComponent(slug)}/${asset}?${query}`
}

/**
 * Resolves and verifies the link once, returning the parsed snapshot and
 * publication date. Everything that can publish a monthly report goes through
 * this: the page, the logo proxy and the contact proxy must agree on what a
 * valid link is, or one of them becomes the weaker door.
 */
async function resolveStoredMonthly(input: { readonly slug: unknown; readonly version: unknown; readonly signature: unknown }): Promise<{
  parsed: MonthlyReportSnapshotV2; publishedAt: string; shareVersion: number
} | null> {
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
    return { parsed, publishedAt: report.published_at, shareVersion }
  } catch {
    return unavailable('lookup')
  }
}

export async function resolvePublishedMonthlyReport(input: { readonly slug: unknown; readonly version: unknown; readonly signature: unknown }): Promise<ResolvedPublishedMonthlyReport | null> {
  const stored = await resolveStoredMonthly(input)
  if (!stored) return null
  const signature = input.signature as string
  const hasLogo = stored.parsed.branding.logoUrl !== null
  const hasContact = stored.parsed.branding.contactLabel !== null && stored.parsed.branding.contactUrl !== null
  return {
    report: copyPublished(stored.parsed), publishedAt: stored.publishedAt,
    logoProxyUrl: hasLogo ? publicAssetUrl('logo', input.slug as string, stored.shareVersion, signature) : null,
    contactProxyUrl: hasContact ? publicAssetUrl('contact', input.slug as string, stored.shareVersion, signature) : null,
  }
}

/**
 * The raw branding destinations for the proxy routes. Deliberately a separate
 * function rather than a field of the page result: this object must never be
 * serialised into a response body.
 */
export async function resolvePublishedMonthlyReportAssets(input: { readonly slug: unknown; readonly version: unknown; readonly signature: unknown }): Promise<MonthlyReportAssets | null> {
  const stored = await resolveStoredMonthly(input)
  if (!stored) return null
  const { logoUrl, contactLabel, contactUrl } = stored.parsed.branding
  return { logoUrl, contactLabel, contactUrl: contactLabel !== null ? contactUrl : null }
}

/** Public copy of a snapshot, for the review page (which resolves by token, not by publication). */
export function publicMonthlyReportFromSnapshot(snapshot: MonthlyReportSnapshotV2): PublicMonthlyReport {
  return copyPublished(snapshot)
}

/**
 * Phase 3 (advisory): the LATEST version of a monthly report, resolved by the
 * review token alone. Reviewers must see a draft before it is published, so this
 * deliberately does not require a published row or a share signature; the token
 * is bound to this report's current version, and the account must still be
 * entitled to online reports.
 */
export type ResolvedReviewMonthlyReport = Readonly<{
  report: PublicMonthlyReport
  reportId: string
  versionId: string
  versionNumber: number
  month: string
  status: 'draft' | 'published' | 'revoked'
  locale: 'en' | 'zh-HK'
  /** Null while the version is a draft: the page must not say "published". */
  publishedAt: string | null
  existing: MonthlyReview | null
  logoProxyUrl: string | null
  contactProxyUrl: string | null
}>

function reviewAssetUrl(asset: 'logo' | 'contact', slug: string, review: string): string {
  return `/api/public/monthly-reports/${encodeURIComponent(slug)}/${asset}?${new URLSearchParams({ review })}`
}

async function verifiedReviewTarget(input: { readonly slug: unknown; readonly review: unknown; readonly now?: Date }) {
  if (typeof input.slug !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(input.slug)) return null
  if (typeof input.review !== 'string') return null
  const target = await loadMonthlyReviewTarget(input.slug)
  if (!target) return null
  if (!verifyReviewToken({ reportId: target.reportId, versionId: target.versionId, token: input.review, now: input.now })) return null
  if (!resolveCommercialEntitlement(target.account as CommercialAccount).features.client_reports_online) return null
  const parsed = parseMonthlyReportSnapshot(target.snapshot)
  if (!parsed || parsed.locale !== target.locale) return null
  return { target, parsed }
}

export async function resolveReviewMonthlyReport(input: { readonly slug: unknown; readonly review: unknown; readonly now?: Date }): Promise<ResolvedReviewMonthlyReport | null> {
  const verified = await verifiedReviewTarget(input)
  if (!verified) return null
  const { target, parsed } = verified
  const reviews = await readMonthlyReviews(target.accountId, target.clientId, target.reportId).catch(() => [])
  const existing = reviews.find(review => review.versionId === target.versionId) ?? null
  return {
    report: copyPublished(parsed),
    reportId: target.reportId,
    versionId: target.versionId,
    versionNumber: target.versionNumber,
    month: target.month,
    status: target.status,
    locale: target.locale,
    publishedAt: target.status === 'published' ? target.publishedAt : null,
    existing,
    logoProxyUrl: parsed.branding.logoUrl !== null ? reviewAssetUrl('logo', input.slug as string, input.review as string) : null,
    contactProxyUrl: parsed.branding.contactLabel !== null && parsed.branding.contactUrl !== null
      ? reviewAssetUrl('contact', input.slug as string, input.review as string) : null,
  }
}

/** Raw branding destinations for the review page's proxy routes. Never returned to a page. */
export async function resolveReviewMonthlyReportAssets(input: { readonly slug: unknown; readonly review: unknown; readonly now?: Date }): Promise<MonthlyReportAssets | null> {
  const verified = await verifiedReviewTarget(input)
  if (!verified) return null
  const { logoUrl, contactLabel, contactUrl } = verified.parsed.branding
  return { logoUrl, contactLabel, contactUrl: contactLabel !== null ? contactUrl : null }
}
