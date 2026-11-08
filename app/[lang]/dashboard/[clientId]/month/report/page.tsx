import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { MonthlyReportView } from '@/components/monthly-report/MonthlyReportView'
import { MonthlyReportEditor } from '@/components/monthly-report/MonthlyReportEditor'
import { MonthlyReportPublish } from '@/components/monthly-report/MonthlyReportPublish'
import { requireAuth } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { db } from '@/lib/db'
import { hongKongMonthKey, isViewableMonth, periodOf } from '@/lib/brand-month/period'
import { loadMonthlyReport } from '@/lib/monthly-report/store'
import { monthLabel, monthlyShareUrl } from '@/lib/monthly-report/service'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Retainer OS Slice C1: the brand's monthly report draft. Reads only; saving is the editor's POST. */
export default async function MonthlyReportPage({ params, searchParams }: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams?: Promise<{ m?: string | string[] }>
}) {
  const { lang, clientId } = await params
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const profile = await requireAuth(locale)
  if (!resolveCommercialEntitlement(profile.accounts).features.client_reports_online) notFound()
  const now = new Date(), asked = (await searchParams)?.m
  const key = typeof asked === 'string' ? asked : hongKongMonthKey(now)
  const period = periodOf(key)
  // Drafting and publishing stay within the month view's lookback; an older month opens only to stop sharing its report.
  const canDraft = isViewableMonth(key, now)
  if (!UUID.test(clientId) || !period || key > hongKongMonthKey(now)) notFound()
  const [client] = await db()`select brand_name, domain from clients where id = ${clientId}::uuid and account_id = ${profile.account_id}::uuid`
  if (!client) notFound()
  const report = await loadMonthlyReport(profile.account_id, clientId, period.month)
  if (!canDraft && !report) notFound()
  const t = await getTranslations('monthlyReport')
  // The report renders in its own language, whatever the dashboard's: a zh-HK report reads the same from /en and /zh-HK.
  const reportLang = report?.snapshot.locale ?? locale
  const r = await getTranslations({ locale: reportLang, namespace: 'monthlyReport' })
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">{String(client.brand_name ?? client.domain ?? '')}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('title')} · {monthLabel(locale, period)}</h1>
          {report ? <p className="mt-1 text-sm text-muted-foreground">{t('draft_version', { n: report.versionNumber })}</p> : null}
        </div>
        {canDraft ? <Link href={`/${locale}/dashboard/${clientId}/month?m=${key}`} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-muted">{t('back_to_month')}</Link> : null}
      </header>
      {report ? <div lang={reportLang}><MonthlyReportView snapshot={report.snapshot} lang={reportLang} copy={{
        delivered: r('delivered'), verifiedLive: r('verified_live'), selfReported: r('self_reported'), none: r('none'),
        visibility: r('visibility'), visibilityPending: r('visibility_pending'),
        visibilityOpening: r('visibility_opening'), visibilityClosing: r('visibility_closing'),
        visibilityChange: r('visibility_change'), visibilityVerdict: r('visibility_verdict'),
        visibilityRising: r('visibility_rising'), visibilityFalling: r('visibility_falling'),
        visibilityPlatform: r('visibility_platform'), visibilityRuleNote: r('visibility_rule_note'),
        search: r('search'), before: r('before'), endOfMonth: r('end_of_month'),
        clicks: r('clicks'), impressions: r('impressions'), notConnected: r('not_connected'), notRecorded: r('not_recorded'), nextMonth: r('next_month'),
      }} /></div> : null}
      {report ? <MonthlyReportPublish clientId={clientId} month={key} versionId={report.versionId} canPublish={canDraft}
        latestIsPublished={report.status === 'published' && report.publishedVersionId === report.versionId} shareUrl={monthlyShareUrl(report)}
        copy={{ shared: t('shared'), notShared: t('not_shared'), shareLink: t('share_link'), publish: t('publish_latest'), revoke: t('revoke'),
          failed: t('publish_failed'), stale: t('stale') }} /> : null}
      {/* Keyed by the saved version, so a save (including the first, server-written default) remounts it with the stored text. */}
      {canDraft ? <MonthlyReportEditor key={report?.versionId ?? 'new'} clientId={clientId} month={key} locale={report?.snapshot.locale ?? locale} narrative={report?.snapshot.executiveSummary ?? null}
        copy={{ language: t('language'), narrative: t('narrative'), save: t('save'), failed: t('failed'), brandingRequired: t('branding_required'), invalidNarrative: t('invalid_narrative') }} /> : null}
    </main>
  )
}
