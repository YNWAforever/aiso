import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { CombinedReport } from '@/components/reports/CombinedReport'
import { PrintButton } from '@/components/reports/PrintButton'
import { requireAuth } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { loadCombinedReport } from '@/lib/reports/combined'
import { isScanId } from '@/lib/result/links'

type CombinedReportPageProps = {
  params: Promise<{ lang: string; clientId: string }>
  searchParams?: Promise<{ scanId?: string | string[] }>
}

export const dynamic = 'force-dynamic'

function reportLocale(lang: string): 'en' | 'zh-HK' {
  return lang === 'zh-HK' ? 'zh-HK' : 'en'
}

export async function generateMetadata({ params }: CombinedReportPageProps): Promise<Metadata> {
  const { lang } = await params
  const t = await getTranslations({ locale: reportLocale(lang), namespace: 'combinedReport' })
  return {
    title: t('meta_title'),
    robots: { index: false, follow: false, nocache: true },
  }
}

export default async function CombinedReportPage({ params, searchParams }: CombinedReportPageProps) {
  const { lang, clientId } = await params
  const locale = reportLocale(lang)
  const t = await getTranslations('combinedReport')
  const profile = await requireAuth(locale)
  const entitlement = resolveCommercialEntitlement(profile.accounts)

  if (!entitlement.features.client_reports_online) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 text-foreground sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('upgrade_title')}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('upgrade_body')}</p>
        <Button asChild className="mt-6 min-h-11">
          <Link href={`/${locale}/pricing`}>{t('upgrade_cta')}</Link>
        </Button>
      </main>
    )
  }

  const requestedScan = (await searchParams)?.scanId
  const scanId = requestedScan === undefined ? undefined : isScanId(requestedScan) ? requestedScan : null
  const report = await loadCombinedReport({ accountId: profile.account_id, clientId, locale, ...(scanId !== undefined ? { scanId } : {}) })
  if (!report) notFound()
  const scanQuery = report.scan.state !== 'selection-unavailable' && scanId ? `?scanId=${encodeURIComponent(scanId)}` : ''

  return (
    <main className="min-h-dvh w-full overflow-x-clip bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10 print:min-h-0 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/${locale}/dashboard/${clientId}/reports${scanQuery}`}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary-accessible underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('back')}
        </Link>
        <PrintButton />
      </div>
      <CombinedReport report={report} clientId={clientId} />
    </main>
  )
}
