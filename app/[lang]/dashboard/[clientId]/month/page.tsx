import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MonthRecord } from '@/components/brand-month/MonthRecord'
import { RecordSnapshotsButton } from '@/components/brand-month/RecordSnapshotsButton'
import { requireAuth } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { dueSnapshots, hongKongMonthKey, isViewableMonth, periodOf, shiftMonth } from '@/lib/brand-month/period'
import { readBrandMonth } from '@/lib/brand-month/store'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Retainer OS Slice B: one brand's Hong Kong month record. Reads only; recording is the button's POST. */
export default async function BrandMonthPage({ params, searchParams }: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams?: Promise<{ m?: string | string[] }>
}) {
  const { lang, clientId } = await params
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const profile = await requireAuth(locale)
  const t = await getTranslations('month')
  if (!resolveCommercialEntitlement(profile.accounts).features.client_reports_online) {
    const r = await getTranslations('reports')
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <Card><CardContent className="p-8 text-center">
          <LockKeyhole className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold">{r('upgrade_title')}</h1>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{r('upgrade_body')}</p>
          <Button asChild className="mt-6 min-h-11"><Link href={`/${locale}/pricing`}>{r('upgrade_cta')}</Link></Button>
        </CardContent></Card>
      </main>
    )
  }

  const now = new Date(), current = hongKongMonthKey(now)
  const asked = (await searchParams)?.m
  const key = typeof asked === 'string' ? asked : current
  const period = periodOf(key)
  if (!UUID.test(clientId) || !period || !isViewableMonth(key, now)) notFound()
  const month = await readBrandMonth(profile.account_id, clientId, period)
  if (month.state === 'not_found') notFound()

  const recorded = new Set(month.snapshots.map(s => s.kind))
  const pending = dueSnapshots(period, now).some(k => !recorded.has(k))
  const href = (m: string) => `/${locale}/dashboard/${clientId}/month?m=${m}`
  const previous = shiftMonth(key, -1), next = shiftMonth(key, 1)
  const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${period.month}T00:00:00Z`))

  return (
    <MonthRecord
      lang={locale}
      brandName={month.brandName}
      monthLabel={monthLabel}
      previousHref={isViewableMonth(previous, now) ? href(previous) : null}
      queueHref={`/${locale}/dashboard/this-month`}
      reportHref={`/${locale}/dashboard/${clientId}/month/report?m=${key}`}
      nextHref={isViewableMonth(next, now) ? href(next) : null}
      snapshots={month.snapshots}
      activity={month.activity}
      recordAction={pending ? <RecordSnapshotsButton clientId={clientId} month={key} label={t('record')} failed={t('record_failed')} /> : undefined}
      copy={{
        title: t('title'), previous: t('previous'), next: t('next'), allBrands: t('all_brands'), report: t('report'),
        delivered: t('delivered'), verifiedLive: t('verified_live'), selfReported: t('self_reported'), none: t('none'),
        figures: t('figures'), opening: t('opening'), closing: t('closing'), notRecorded: t('not_recorded'), notConnected: t('not_connected'),
        scanScore: t('scan_score'), shareOfVoice: t('share_of_voice'), searchClicks: t('search_clicks'), searchImpressions: t('search_impressions'),
        activity: t('activity'), workItemsOpened: t('work_items_opened'), workItemsDone: t('work_items_done'), siteEditsSent: t('site_edits_sent'),
        receiptsCompleted: t('receipts_completed'), receiptsRejected: t('receipts_rejected'),
      }}
    />
  )
}
