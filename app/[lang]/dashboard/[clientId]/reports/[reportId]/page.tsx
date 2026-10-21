import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { ReportBuilder, type ReportWorkspaceReport } from '@/components/reports/ReportBuilder'
import {
  ReportImprovementTasks,
  type ReportImprovementFinding,
} from '@/components/reports/ReportImprovementTasks'
import { requireAuth } from '@/lib/auth'
import { parseClientReportSnapshot } from '@/lib/reports/client-dto'
import { listAuthenticatedClientReports } from '@/lib/reports/service'
import {
  listClientReportVersions,
  loadOwnedClientReport,
  loadOwnedReportScan,
} from '@/lib/reports/store'
import { buildReportFindingCandidates } from '@/lib/reports/finding-candidates'
import { findOwnedDraft } from '@/lib/work-items/store'
import { opportunityKey } from '@/lib/opportunities/fingerprint'
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
  let findings: ReportImprovementFinding[] = []
  let findingsState: 'ok' | 'empty' | 'unavailable' = 'unavailable'
  try {
    const scan = await loadOwnedReportScan({
      accountId: profile.account_id,
      scanId: latest.source_scan_id,
      clientDomain: latestSnapshot.client.domain,
    })
    if (scan) {
      const candidates = buildReportFindingCandidates({
        reportId,
        reportVersionId: latest.id,
        reportVersionNumber: latest.version_number,
        reportCreatedAt: latest.created_at,
        scanId: scan.id,
        scanCreatedAt: scan.createdAt,
        scanResults: scan.results,
        snapshot: latestSnapshot,
        locale,
      })
      findings = await Promise.all(candidates.map(async finding => ({
        ...finding,
        existingTask: await findOwnedDraft(
          profile.account_id,
          clientId,
          opportunityKey(finding.ruleVersion, finding.source),
        ),
      })))
      findingsState = findings.length ? 'ok' : 'empty'
    }
  } catch {
    findingsState = 'unavailable'
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <p className="text-sm font-medium text-primary">{latestSnapshot.client.name}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('edit_title')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t('edit_body')}</p>
      </div>
      <ReportBuilder
        key={`${profile.account_id}:${profile.id}:${clientId}:${reportId}`}
        saveScope={`${profile.account_id}:${profile.id}`}
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
      <ReportImprovementTasks
        clientId={clientId}
        brandName={latestSnapshot.client.name}
        domain={latestSnapshot.client.domain}
        reportId={reportId}
        reportVersionId={latest.id}
        reportVersionNumber={latest.version_number}
        latestVersionNumber={reportDto.latestVersionNumber ?? latest.version_number}
        locale={locale}
        findingsState={findingsState}
        findings={findings}
      />
    </main>
  )
}
