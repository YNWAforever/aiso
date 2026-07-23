import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { LockKeyhole, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ReportsList, type ReportsListItem } from '@/components/reports/ReportsList'
import { requireAuth } from '@/lib/auth'
import { listAuthenticatedClientReports } from '@/lib/reports/service'
import { loadOwnedReportClient } from '@/lib/reports/store'
import { resolveCommercialEntitlement } from '@/lib/tier'

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function toReportsListItem(value: Record<string, unknown>): ReportsListItem | null {
  if (
    typeof value.id !== 'string'
    || (value.status !== 'draft' && value.status !== 'published' && value.status !== 'revoked')
    || !isNullableNumber(value.latestVersionNumber)
    || !isNullableNumber(value.publishedVersionNumber)
    || !isNullableString(value.publishedAt)
    || !isNullableString(value.firstViewedAt)
    || !isNullableString(value.lastViewedAt)
    || !isNullableNumber(value.viewCount)
    || !isNullableNumber(value.ctaClickCount)
  ) return null

  return {
    id: value.id,
    status: value.status,
    latestVersionNumber: value.latestVersionNumber,
    publishedVersionNumber: value.publishedVersionNumber,
    publishedAt: value.publishedAt,
    firstViewedAt: value.firstViewedAt,
    lastViewedAt: value.lastViewedAt,
    viewCount: value.viewCount,
    ctaClickCount: value.ctaClickCount,
    signedUrl: typeof value.signedUrl === 'string' ? value.signedUrl : undefined,
  }
}

export default async function ClientReportsPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const t = await getTranslations('reports')
  const profile = await requireAuth(locale)
  const entitlement = resolveCommercialEntitlement(profile.accounts)
  const client = await loadOwnedReportClient({ accountId: profile.account_id, clientId })
  if (!client) notFound()

  if (!entitlement.features.client_reports_online) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <Card>
          <CardContent className="p-8 text-center">
            <LockKeyhole className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold">{t('upgrade_title')}</h1>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{t('upgrade_body')}</p>
            <Button asChild className="mt-6 min-h-11">
              <Link href={`/${locale}/pricing`}>{t('upgrade_cta')}</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  let reports: ReportsListItem[] = []
  let unavailable = false
  try {
    const result = await listAuthenticatedClientReports(clientId)
    const parsedReports = result.reports.map(toReportsListItem)
    if (parsedReports.some(report => report === null)) throw new Error('Invalid report DTO')
    reports = parsedReports.filter((report): report is ReportsListItem => report !== null)
  } catch {
    unavailable = true
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">{client.name}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('list_title')}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t('list_body')}</p>
        </div>
        <Button asChild className="min-h-11">
          <Link href={`/${locale}/dashboard/${clientId}?step=scan`}>
            <Plus aria-hidden="true" />
            {t('choose_scan')}
          </Link>
        </Button>
      </div>

      {unavailable ? (
        <Card>
          <CardContent className="p-8 text-center">
            <h2 className="text-lg font-semibold">{t('unavailable_title')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('unavailable_body')}</p>
            <Button asChild variant="outline" className="mt-5 min-h-11">
              <Link href={`/${locale}/dashboard/${clientId}/reports`}>{t('retry')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ReportsList
          lang={locale}
          clientId={clientId}
          clientName={client.name}
          domain={client.domain}
          reports={reports}
        />
      )}
    </main>
  )
}
