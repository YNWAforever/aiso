import 'server-only'
import { db } from '@/lib/db'
import type { ReportLocale } from '@/lib/reports/types'
import { MONTHLY_OPEN_ITEMS_MAX, parseMonthlyReportSnapshot, type MonthlyReportSnapshotV2 } from './snapshot'

export type MonthlyReportRead = {
  reportId: string
  status: 'draft' | 'published' | 'revoked'
  versionId: string
  versionNumber: number
  createdAt: string
  snapshot: MonthlyReportSnapshotV2
}

export class MonthlyReportExistsError extends Error {}

const iso = (v: unknown) => v instanceof Date ? v.toISOString() : String(v)

/** This brand's monthly report for a month, with its latest version. Only `kind = 'monthly'` rows (098). */
export async function loadMonthlyReport(accountId: string, clientId: string, month: string): Promise<MonthlyReportRead | null> {
  const [row] = await db()`
    select r.id as report_id, r.status, v.id as version_id, v.version_number, v.created_at, v.snapshot, v.snapshot_schema_version
    from client_reports r
    join client_report_versions v on v.id = r.latest_version_id and v.report_id = r.id and v.account_id = r.account_id
    where r.account_id = ${accountId}::uuid and r.client_id = ${clientId}::uuid
      and r.kind = 'monthly' and r.report_month = ${month}::date
    limit 1`
  if (!row) return null
  const snapshot = row.snapshot_schema_version === 2 ? parseMonthlyReportSnapshot(row.snapshot) : null
  if (!snapshot) throw new Error('MONTHLY_REPORT_INVALID')
  return { reportId: String(row.report_id), status: row.status as MonthlyReportRead['status'], versionId: String(row.version_id),
    versionNumber: Number(row.version_number), createdAt: iso(row.created_at), snapshot }
}

/** Work items still open (not marked done), newest first, for the report's "next month" section. */
export async function loadOpenWorkItems(accountId: string, clientId: string): Promise<{ title: string }[]> {
  const rows = await db()`
    select title from evidence_work_items
    where account_id = ${accountId}::uuid and client_id = ${clientId}::uuid and operation_status <> 'done'
    order by updated_at desc, id limit ${MONTHLY_OPEN_ITEMS_MAX}`
  return rows.map(r => ({ title: String(r.title ?? '') }))
}

type WriteInput = { accountId: string; clientId: string; locale: ReportLocale; narrative: string; snapshot: MonthlyReportSnapshotV2; actorId: string }

/** First draft for the month: a new monthly report with version 1. */
export async function createMonthlyReport(input: WriteInput & { month: string }): Promise<{ reportId: string; versionNumber: number }> {
  try {
    const [row] = await db()`select public.create_monthly_client_report_with_version(
      ${input.accountId}::uuid, ${input.clientId}::uuid, ${input.month}::date, ${input.locale}::text,
      ${input.narrative}::text, ${JSON.stringify(input.snapshot)}::jsonb, ${input.actorId}::uuid) as result`
    return written(row?.result)
  } catch (error) {
    if (error instanceof Error && /CLIENT_REPORT_MONTH_EXISTS|client_reports_monthly_unique_idx/.test(error.message)) throw new MonthlyReportExistsError()
    throw error
  }
}

/** A later draft of the month's report: a new version, never a rewrite. */
export async function appendMonthlyReport(input: WriteInput & { reportId: string }): Promise<{ reportId: string; versionNumber: number }> {
  const [row] = await db()`select public.append_monthly_client_report_version(
    ${input.reportId}::uuid, ${input.accountId}::uuid, ${input.clientId}::uuid, ${input.locale}::text,
    ${input.narrative}::text, ${JSON.stringify(input.snapshot)}::jsonb, ${input.actorId}::uuid) as result`
  return written(row?.result)
}

function written(result: unknown): { reportId: string; versionNumber: number } {
  const r = result as { report?: { id?: unknown }; version?: { version_number?: unknown; snapshot_schema_version?: unknown } } | undefined
  if (typeof r?.report?.id !== 'string' || typeof r.version?.version_number !== 'number' || r.version.snapshot_schema_version !== 2) {
    throw new Error('MONTHLY_REPORT_WRITE_UNCONFIRMED')
  }
  return { reportId: r.report.id, versionNumber: r.version.version_number }
}
