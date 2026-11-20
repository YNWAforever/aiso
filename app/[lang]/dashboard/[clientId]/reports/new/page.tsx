import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { LockKeyhole, Settings2 } from 'lucide-react'
import { ReportBuilder } from '@/components/reports/ReportBuilder'
import { ScanPicker } from '@/components/dashboard/ScanPicker'
import { isOwnedWorkspaceScan, loadOwnedScanChoices } from '@/lib/workspace/scan-choices'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requireAuth } from '@/lib/auth'
import { buildClientReportSnapshot } from '@/lib/reports/snapshot'
import {
  loadOwnedReportClient,
  loadOwnedReportScan,
  loadPreviousReportScan,
  loadReportBranding,
  loadReportRecommendations,
} from '@/lib/reports/store'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { normalizeReportDomain } from '@/lib/reports/comparison'

export default async function NewClientReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams: Promise<{ scanId?: string | string[] }>
}) {
  const { lang, clientId } = await params
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const query = await searchParams
  const scanId = typeof query.scanId === 'string' ? query.scanId : null
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

  const domain = client.domain ? normalizeReportDomain(client.domain) : null
  if (!domain) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <Card>
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-semibold">{t('website_required_title')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('website_required_body')}</p>
            <Button asChild variant="outline" className="mt-6 min-h-11">
              <Link href={`/${locale}/dashboard/${clientId}?step=scan`}>{t('run_scan')}</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const ownedScans = await loadOwnedScanChoices({ accountId: profile.account_id, clientId })
  const selectedScanAvailable = ownedScans.some(scan => scan.id === scanId)
  const scans = ownedScans.filter(scan => normalizeReportDomain(scan.domain) === domain)
  const picker = <ScanPicker lang={locale} action={`/${locale}/dashboard/${clientId}/reports/new`} scans={scans} selectedScanId={scanId} />
  const currentScan = scanId && scans.some(scan => scan.id === scanId)
    ? await loadOwnedReportScan({ accountId: profile.account_id, scanId, clientId, clientDomain: domain })
    : null

  if (!scanId || !currentScan || currentScan.id !== scanId) {
    const body = query.scanId === undefined ? 'scan_required_body'
      : scans.some(scan => scan.id === scanId) ? 'scan_selection_unavailable'
        : selectedScanAvailable ? 'scan_domain_mismatch'
          : scanId && await isOwnedWorkspaceScan({ accountId: profile.account_id, clientId, scanId })
            ? 'scan_collection_unavailable' : 'scan_selection_unavailable'
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <Card>
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-semibold">{t('scan_required_title')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t(body)}</p>
            <div className="mt-6 text-left">{picker}</div>
            {!scans.length && <Button asChild variant="outline" className="mt-6 min-h-11">
              <Link href={`/${locale}/dashboard/${clientId}?step=scan&url=${encodeURIComponent(`https://${domain}`)}`}>{t('run_scan')}</Link>
            </Button>}
          </CardContent>
        </Card>
      </main>
    )
  }

  const [previousScan, recommendations, branding] = await Promise.all([
    loadPreviousReportScan({ accountId: profile.account_id, currentScan }),
    loadReportRecommendations({
      accountId: profile.account_id,
      scanId,
      clientDomain: domain,
    }),
    loadReportBranding({ accountId: profile.account_id }),
  ])

  if (!branding) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        {picker}
        <Card>
          <CardContent className="p-8 text-center">
            <Settings2 className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold">{t('branding_required_title')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('branding_required_body')}</p>
            <Button asChild className="mt-6 min-h-11">
              <Link href={`/${locale}/dashboard/settings#report-branding`}>{t('configure_branding')}</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const snapshot = buildClientReportSnapshot({
    locale,
    branding,
    client: { name: client.name, domain },
    currentScan,
    previousScan,
    recommendations,
  })

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 print:max-w-none print:p-0">
      <div className="mb-6 print:hidden">
        <p className="text-sm font-medium text-primary">{client.name}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('new_title')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t('new_body')}</p>
      </div>
      <div className="print:hidden">{picker}</div>
      <ReportBuilder
        lang={locale}
        clientId={clientId}
        scanId={scanId}
        initialReport={null}
        initialSnapshot={snapshot}
      />
    </main>
  )
}
