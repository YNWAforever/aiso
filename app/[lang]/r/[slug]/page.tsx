import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { OnePageReport } from '@/components/reports/OnePageReport'
import { resolvePublishedClientReport } from '@/lib/reports/public'
import { incrementClientReportView } from '@/lib/reports/store'
import { resolvePublishedMonthlyReport } from '@/lib/monthly-report/public'
import { PublicMonthlyReport } from '@/components/monthly-report/PublicMonthlyReport'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

type PublicReportPageProps = {
  params: Promise<{ lang: string; slug: string }>
  searchParams: Promise<{ v?: string | string[]; s?: string | string[] }>
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
        <PublicMonthlyReport report={monthly.report} publishedAt={monthly.publishedAt} title={m.title} publishedLabel={m.published}
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
