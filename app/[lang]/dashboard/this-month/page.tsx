import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MonthQueue } from '@/components/brand-month/MonthQueue'
import { requireAuth } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { readMonthQueue } from '@/lib/brand-month/queue'
import { SITE_EDIT_MONTHLY_SENDS_PER_BRAND } from '@/lib/site-edit/handoff'

export const dynamic = 'force-dynamic'

/** Retainer OS Slice B: this Hong Kong month's open items across the account's brands. Reads only. */
export default async function MonthQueuePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const profile = await requireAuth(locale)
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
  const t = await getTranslations('monthQueue')
  const rows = await readMonthQueue(profile.account_id)
  return (
    <MonthQueue lang={locale} rows={rows} sendCap={SITE_EDIT_MONTHLY_SENDS_PER_BRAND}
      monthHref={clientId => `/${locale}/dashboard/${clientId}/month`}
      copy={{ title: t('title'), brand: t('brand'), approvals: t('approvals'), editsUnverified: t('edits_unverified'), sends: t('sends'),
        pulse: t('pulse'), searchConsole: t('search_console'), monthRecord: t('month_record'), overdue: t('overdue'), notEnabled: t('not_enabled'),
        notConnected: t('not_connected'), stale: t('stale'), recorded: t('recorded'), notRecorded: t('not_recorded'), none: t('none'), allClear: t('all_clear') }} />
  )
}
