import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { ReportBuilder, type ReportWorkspaceReport } from '@/components/reports/ReportBuilder'
import { requireAuth } from '@/lib/auth'
import { parseClientReportSnapshot } from '@/lib/reports/client-dto'
import { listAuthenticatedClientReports } from '@/lib/reports/service'
import {
  listClientReportVersions,
  loadOwnedClientReport,
} from '@/lib/reports/store'
import { resolveCommercialEntitlement } from '@/lib/tier'

export default async function EditClientReportPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string; reportId: string }>
}) {
  const { lang, clientId, reportId } = await params
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const t = await getTranslations('reports')
  const profile = await requireAuth(locale)
  const entitlement = resolveCommercialEntitlement(profile.accounts)
  if (!entitlement.features.client_reports_online) notFound()

  const report = await loadOwnedClientReport({
    accountId: profile.account_id,
    clientId,
    reportId,
  })
  if (!report) notFound()

  const versions = await listClientReportVersions({
    accountId: profile.account_id,
    clientId,
    reportId,
  })
  const latest = versions.find(version => version.id === report.latest_version_id)
  const latestSnapshot = parseClientReportSnapshot(latest?.snapshot)
  if (!latest?.source_scan_id || !latestSnapshot) notFound()

  const listed = await listAuthenticatedClientReports(clientId)
  const reportDto = listed.reports.find(item => item.id === reportId) as ReportWorkspaceReport | undefined
  if (!reportDto) notFound()

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <p className="text-sm font-medium text-primary">{latestSnapshot.client.name}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('edit_title')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t('edit_body')}</p>
      </div>
      <ReportBuilder
        lang={locale}
        clientId={clientId}
        scanId={latest.source_scan_id}
        initialReport={reportDto}
        initialSnapshot={latestSnapshot}
        initialReviewArtifact={{
          versionId: latest.id,
          versionNumber: latest.version_number,
          snapshot: latestSnapshot,
        }}
      />
    </main>
  )
}
