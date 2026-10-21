import 'server-only'
import { db } from '@/lib/db'
import { parseClientReportSnapshot } from './client-dto'
import type { EvidenceCheckKey } from '@/lib/scan-evidence'
import type { ReportFindingProvenance } from '@/lib/opportunities/types'
import type { ReportLocale } from './types'

export type LoadedReportFinding = Omit<ReportFindingProvenance, 'targetOrigin'>

/**
 * Read the exact report version selected by the user. The latest report is not
 * substituted: a task created from v2 must retain v2 even after v3 exists.
 */
export async function loadOwnedReportFinding(input: {
  accountId: string
  clientId: string
  reportVersionId: string
  scanId: string
  checkKey: EvidenceCheckKey
  locale: ReportLocale
}): Promise<LoadedReportFinding | null> {
  const sql = db()
  const rows = await sql`
    select v.id, v.report_id, v.version_number, v.source_scan_id, v.locale, v.snapshot, v.created_at
    from public.client_report_versions v
    join public.client_reports r
      on r.id=v.report_id and r.account_id=v.account_id and r.client_id=v.client_id
    join public.clients c on c.id=v.client_id and c.account_id=v.account_id
    where v.account_id=${input.accountId}
      and v.client_id=${input.clientId}
      and v.id=${input.reportVersionId}
    limit 1
  `
  const row = rows[0] as {
    id?: unknown
    report_id?: unknown
    version_number?: unknown
    source_scan_id?: unknown
    locale?: unknown
    snapshot?: unknown
    created_at?: unknown
  } | undefined
  const snapshot = parseClientReportSnapshot(row?.snapshot)
  if (!row
    || row.source_scan_id !== input.scanId
    || row.locale !== input.locale
    || snapshot?.locale !== input.locale
    || typeof row.id !== 'string'
    || typeof row.report_id !== 'string'
    || !Number.isSafeInteger(Number(row.version_number))
    || Number(row.version_number) < 1) return null
  const fix = snapshot.priorityFixes.find(priority => priority.key === input.checkKey)
  if (!fix) return null
  const createdAt = row.created_at instanceof Date
    ? row.created_at.toISOString()
    : typeof row.created_at === 'string' ? row.created_at : ''
  if (!Number.isFinite(Date.parse(createdAt))) return null
  return {
    reportId: row.report_id,
    reportVersionId: row.id,
    reportVersionNumber: Number(row.version_number),
    reportCreatedAt: createdAt,
    findingKey: input.checkKey,
    findingTitle: fix.title,
    findingRationale: fix.rationale,
    findingNextStep: fix.nextStep,
    expectedImpact: fix.expectedImpact,
  }
}
