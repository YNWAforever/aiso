import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { MonthlyReportView } from '@/components/monthly-report/MonthlyReportView'
import { MonthlyReportEditor } from '@/components/monthly-report/MonthlyReportEditor'
import { requireAuth } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { db } from '@/lib/db'
import { hongKongMonthKey, isViewableMonth, periodOf } from '@/lib/brand-month/period'
import { loadMonthlyReport } from '@/lib/monthly-report/store'
import { monthLabel } from '@/lib/monthly-report/service'

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
  if (!UUID.test(clientId) || !period || !isViewableMonth(key, now)) notFound()
  const [client] = await db()`select brand_name, domain from clients where id = ${clientId}::uuid and account_id = ${profile.account_id}::uuid`
  if (!client) notFound()
  const report = await loadMonthlyReport(profile.account_id, clientId, period.month)
  const t = await getTranslations('monthlyReport')
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">{String(client.brand_name ?? client.domain ?? '')}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('title')} · {monthLabel(locale, period)}</h1>
          {report ? <p className="mt-1 text-sm text-muted-foreground">{t('draft_version', { n: report.versionNumber })}</p> : null}
        </div>
        <Link href={`/${locale}/dashboard/${clientId}/month?m=${key}`} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-muted">{t('back_to_month')}</Link>
      </header>
      {report ? <MonthlyReportView snapshot={report.snapshot} lang={locale} copy={{
        delivered: t('delivered'), verifiedLive: t('verified_live'), selfReported: t('self_reported'), none: t('none'),
        visibility: t('visibility'), visibilityPending: t('visibility_pending'), search: t('search'), before: t('before'), endOfMonth: t('end_of_month'),
        clicks: t('clicks'), impressions: t('impressions'), notConnected: t('not_connected'), notRecorded: t('not_recorded'), nextMonth: t('next_month'),
      }} /> : null}
      <MonthlyReportEditor clientId={clientId} month={key} locale={report?.snapshot.locale ?? locale} narrative={report?.snapshot.executiveSummary ?? null}
        copy={{ language: t('language'), narrative: t('narrative'), save: t('save'), failed: t('failed'), brandingRequired: t('branding_required'), invalidNarrative: t('invalid_narrative') }} />
    </main>
  )
}
