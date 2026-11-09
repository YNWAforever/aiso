import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { OnePageReport } from '@/components/reports/OnePageReport'
import { PrintButton, PrintThemeGuard } from '@/components/reports/PrintButton'
import { resolvePublishedClientReport } from '@/lib/reports/public'
import { incrementClientReportView } from '@/lib/reports/store'
import { resolvePublishedMonthlyReport, resolveReviewMonthlyReport } from '@/lib/monthly-report/public'
import { PublicMonthlyReport } from '@/components/monthly-report/PublicMonthlyReport'
import { MonthlyReviewForm } from '@/components/monthly-report/MonthlyReviewForm'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

type PublicReportPageProps = {
  params: Promise<{ lang: string; slug: string }>
  searchParams: Promise<{ v?: string | string[]; s?: string | string[]; review?: string | string[] }>
}

export const dynamic = 'force-dynamic'

function reportLocale(value: string): 'en' | 'zh-HK' {
  return value === 'zh-HK' ? 'zh-HK' : 'en'
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicReportPageProps): Promise<Metadata> {
  const [{ lang }] = await Promise.all([params, searchParams])
  return {
    title: (reportLocale(lang) === 'zh-HK' ? zhHK : en).reportPage.meta_title,
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  }
}

export default async function PublicReportPage({
  params,
  searchParams,
}: PublicReportPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const reviewParam = Array.isArray(query.review) ? query.review[0] : query.review
  if (typeof reviewParam === 'string' && reviewParam.length > 0) {
    // Phase 3: a review link resolves the LATEST version (draft or published) by
    // its own token; an invalid or expired token falls through to the normal
    // share-link resolution below, which 404s unless the report is published.
    const review = await resolveReviewMonthlyReport({ slug, review: reviewParam })
    if (review) {
      const messages = review.locale === 'zh-HK' ? zhHK : en
      const m = messages.monthlyReport, rc = messages.monthlyReview
      return (
        <main className="min-h-dvh w-full overflow-x-clip bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10 print:min-h-0 print:bg-white print:p-0">
          <PrintThemeGuard />
          <div className="mx-auto mb-4 flex w-full max-w-3xl justify-end print:hidden">
            <PrintButton />
          </div>
          <div className="mx-auto mb-6 w-full max-w-3xl print:hidden">
            <MonthlyReviewForm slug={slug} token={reviewParam} locale={review.locale} existing={review.existing}
              copy={{ title: rc.title, intro: rc.intro, approve: rc.approve, requestChanges: rc.request_changes,
                nameLabel: rc.name_label, namePlaceholder: rc.name_placeholder, commentLabel: rc.comment_label,
                commentPlaceholder: rc.comment_placeholder, commentRequired: rc.comment_required,
                submit: rc.submit, submitting: rc.submitting, recordedApproved: rc.recorded_approved,
                recordedByApproved: rc.recorded_by_approved, recordedChanges: rc.recorded_changes,
                recordedByChanges: rc.recorded_by_changes, failed: rc.failed, already: rc.already }} />
          </div>
          <PublicMonthlyReport report={review.report} publishedAt={review.publishedAt} title={m.title} publishedLabel={m.published}
            logoProxyUrl={review.logoProxyUrl} contactProxyUrl={review.contactProxyUrl}
            copy={{ delivered: m.delivered, verifiedLive: m.verified_live, selfReported: m.self_reported, none: m.none,
              visibility: m.visibility, visibilityPending: m.visibility_pending,
              visibilityOpening: m.visibility_opening, visibilityClosing: m.visibility_closing,
              visibilityChange: m.visibility_change, visibilityVerdict: m.visibility_verdict,
              visibilityRising: m.visibility_rising, visibilityFalling: m.visibility_falling,
              visibilityPlatform: m.visibility_platform, visibilityRuleNote: m.visibility_rule_note,
              search: m.search, before: m.before,
              endOfMonth: m.end_of_month, clicks: m.clicks, impressions: m.impressions, notConnected: m.not_connected,
              notRecorded: m.not_recorded, nextMonth: m.next_month }} />
        </main>
      )
    }
  }
  const resolved = await resolvePublishedClientReport({
    slug,
    version: query.v,
    signature: query.s,
  })
  if (!resolved) {
    // Retainer OS C2: a published monthly report shares the same signed link
    // format; the scan resolver never reads monthly rows (kind = 'scan').
    const monthly = await resolvePublishedMonthlyReport({ slug, version: query.v, signature: query.s })
    if (!monthly) notFound()
    try {
      await incrementClientReportView({ publicSlug: slug, shareVersion: Number(query.v) })
    } catch {
      // Aggregate engagement is best-effort and must never block a valid report.
    }
    const m = (monthly.report.locale === 'zh-HK' ? zhHK : en).monthlyReport
    return (
      <main className="min-h-dvh w-full overflow-x-clip bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10 print:min-h-0 print:bg-white print:p-0">
        {/* Same "Download PDF" affordance as the scan report's one-page view. */}
        <PrintThemeGuard />
        <div className="mx-auto mb-4 flex w-full max-w-3xl justify-end print:hidden">
          <PrintButton />
        </div>
        <PublicMonthlyReport report={monthly.report} publishedAt={monthly.publishedAt} title={m.title} publishedLabel={m.published}
          logoProxyUrl={monthly.logoProxyUrl} contactProxyUrl={monthly.contactProxyUrl}
          copy={{ delivered: m.delivered, verifiedLive: m.verified_live, selfReported: m.self_reported, none: m.none,
            visibility: m.visibility, visibilityPending: m.visibility_pending,
            visibilityOpening: m.visibility_opening, visibilityClosing: m.visibility_closing,
            visibilityChange: m.visibility_change, visibilityVerdict: m.visibility_verdict,
            visibilityRising: m.visibility_rising, visibilityFalling: m.visibility_falling,
            visibilityPlatform: m.visibility_platform, visibilityRuleNote: m.visibility_rule_note,
            search: m.search, before: m.before,
            endOfMonth: m.end_of_month, clicks: m.clicks, impressions: m.impressions, notConnected: m.not_connected,
            notRecorded: m.not_recorded, nextMonth: m.next_month }} />
      </main>
    )
  }

  try {
    await incrementClientReportView({
      publicSlug: slug,
      shareVersion: Number(query.v),
    })
  } catch {
    // Aggregate engagement is best-effort and must never block a valid report.
  }

  const { report, publishedAt, logoProxyUrl, contactProxyUrl } = resolved.dto

  return (
    <main className="min-h-dvh w-full overflow-x-clip bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10 print:min-h-0 print:bg-white print:p-0">
      <OnePageReport
        variant="page"
        printable
        snapshot={report}
        publishedAt={publishedAt}
        logoProxyUrl={logoProxyUrl}
        contactProxyUrl={contactProxyUrl}
      />
    </main>
  )
}
