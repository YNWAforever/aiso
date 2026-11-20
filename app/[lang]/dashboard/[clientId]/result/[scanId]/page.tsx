import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { LoadError } from '@/components/dashboard/states/LoadError'
import { ResultClient } from '@/components/result/ResultClient'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildPublicResultSummary } from '@/lib/result-access'
import { buildOwnedResultDetails, buildOwnedResultEvidence } from '@/lib/result-evidence'
import { isScanId, scanReportHref } from '@/lib/result/links'
import { redactSecrets } from '@/lib/security/redact-secrets'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { Scan } from '@/lib/types'

export default async function DashboardResultPage({ params }: {
  params: Promise<{ lang: string; clientId: string; scanId: string }>
}) {
  const { lang, clientId, scanId } = await params
  const profile = await requireAuth(lang)
  if (!isScanId(clientId) || !isScanId(scanId)) notFound()

  let scan: Scan | null
  try {
    const rows = await db()`
      select id, domain, score::float8 as score, grade, industry, region, created_at, results
      from scans where id = ${scanId} and account_id = ${profile.account_id} and client_id = ${clientId}
      limit 1
    `
    const row = rows[0]
    scan = row ? {
      ...row,
      score: row.score == null ? null : Number(row.score),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    } as Scan : null
  } catch (error) {
    console.error('[dashboard-result] scan query failed:', redactSecrets(error instanceof Error ? error.message : String(error)))
    const t = await getTranslations('dashboard')
    return <LoadError title={t('workspace_load_error_title')} body={t('workspace_load_error_body')}
      retryHref={scanReportHref(lang, clientId, scanId)} backHref={`/${lang}/dashboard`} />
  }

  if (!scan) notFound()
  const features = resolveCommercialEntitlement(profile.accounts).features
  const results = scan.results ?? {}
  return (
    <ResultClient lang={lang} summary={buildPublicResultSummary({ ...scan, results })}
      fullScan={{ id: scan.id, results: buildOwnedResultDetails(results) }}
      ownedEvidence={buildOwnedResultEvidence(results.evidence, results)}
      workspace={{ clientId, canShare: features.client_reports_online }} />
  )
}
