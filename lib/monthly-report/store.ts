import 'server-only'
import { db } from '@/lib/db'
import type { ReportLocale } from '@/lib/reports/types'
import { MONTHLY_OPEN_ITEMS_MAX, parseMonthlyReportSnapshot, type MonthlyReportSnapshotV2 } from './snapshot'

export type MonthlyReportRead = {
  reportId: string
  status: 'draft' | 'published' | 'revoked'
  /** Set while published: the share link is built from these and the version's locale. */
  publicSlug: string
  shareVersion: number
  publishedVersionId: string | null
  publishedLocale: 'en' | 'zh-HK' | null
  versionId: string
  versionNumber: number
  createdAt: string
  snapshot: MonthlyReportSnapshotV2
}

export class MonthlyReportExistsError extends Error {}

const iso = (v: unknown) => v instanceof Date ? v.toISOString() : String(v)

/**
 * A brand's monthly reports, newest month first, for the reports list. Monthly
 * rows share `client_reports` with scan reports but never appear in the scan
 * flow, so this is the only reader that lists them across months (098).
 */
export type MonthlyReportListItem = {
  reportId: string
  month: string
  status: 'draft' | 'published' | 'revoked'
  publicSlug: string
  shareVersion: number
  locale: 'en' | 'zh-HK'
  versionNumber: number
  publishedVersionNumber: number | null
  publishedLocale: 'en' | 'zh-HK' | null
  publishedAt: string | null
}

export async function listMonthlyReports(accountId: string, clientId: string): Promise<MonthlyReportListItem[]> {
  const rows = await db()`
    select r.id as report_id, r.status, r.public_slug, r.share_version, r.published_at,
           r.report_month::text as month, v.version_number,
           v.snapshot->>'locale' as locale,
           p.version_number as published_version_number, p.locale as published_locale
    from client_reports r
    join client_report_versions v on v.id = r.latest_version_id and v.report_id = r.id and v.account_id = r.account_id
    left join client_report_versions p on p.id = r.published_version_id and p.report_id = r.id and p.account_id = r.account_id
    where r.account_id = ${accountId}::uuid and r.client_id = ${clientId}::uuid and r.kind = 'monthly'
    order by r.report_month desc`
  return rows.map(row => ({
    reportId: String(row.report_id),
    month: String(row.month).slice(0, 7),
    status: row.status as MonthlyReportListItem['status'],
    publicSlug: String(row.public_slug),
    shareVersion: Number(row.share_version),
    locale: row.locale === 'zh-HK' ? 'zh-HK' : 'en',
    versionNumber: Number(row.version_number),
    publishedVersionNumber: row.published_version_number === null ? null : Number(row.published_version_number),
    publishedLocale: row.published_locale === 'zh-HK' ? 'zh-HK' : row.published_locale === 'en' ? 'en' : null,
    publishedAt: row.published_at ? iso(row.published_at) : null,
  }))
}

/** This brand's monthly report for a month, with its latest version. Only `kind = 'monthly'` rows (098). */
export async function loadMonthlyReport(accountId: string, clientId: string, month: string): Promise<MonthlyReportRead | null> {
  const [row] = await db()`
    select r.id as report_id, r.status, r.public_slug, r.share_version, r.published_version_id,
           (select p.locale from client_report_versions p where p.id = r.published_version_id and p.report_id = r.id
             and p.account_id = r.account_id) as published_locale,
           v.id as version_id, v.version_number, v.created_at, v.snapshot, v.snapshot_schema_version
    from client_reports r
    join client_report_versions v on v.id = r.latest_version_id and v.report_id = r.id and v.account_id = r.account_id
    where r.account_id = ${accountId}::uuid and r.client_id = ${clientId}::uuid
      and r.kind = 'monthly' and r.report_month = ${month}::date
    limit 1`
  if (!row) return null
  const snapshot = row.snapshot_schema_version === 2 ? parseMonthlyReportSnapshot(row.snapshot) : null
  if (!snapshot) throw new Error('MONTHLY_REPORT_INVALID')
  return { reportId: String(row.report_id), status: row.status as MonthlyReportRead['status'],
    publicSlug: String(row.public_slug), shareVersion: Number(row.share_version),
    publishedVersionId: row.published_version_id ? String(row.published_version_id) : null,
    publishedLocale: row.published_locale === 'en' || row.published_locale === 'zh-HK' ? row.published_locale : null,
    versionId: String(row.version_id),
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
    // db() sanitises driver errors: the RPC's signal survives by name (lib/db.ts allow-list), and a
    // unique violation keeps only its SQLSTATE. In this RPC, 23505 can only be the monthly unique
    // index (a concurrent create): the report row is new, so its version 1 cannot collide.
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
    if (code === '23505' || (error instanceof Error && error.message === 'CLIENT_REPORT_MONTH_EXISTS')) throw new MonthlyReportExistsError()
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

export type PublicationResult = { status: 'published' | 'revoked'; publicSlug: string; shareVersion: number }

function publication(result: unknown, expected: 'published' | 'revoked'): PublicationResult {
  const r = (result as { report?: Record<string, unknown> } | undefined)?.report
  if (!r || r.status !== expected || r.kind !== 'monthly' || typeof r.public_slug !== 'string' || typeof r.share_version !== 'number') {
    throw new Error('MONTHLY_REPORT_PUBLICATION_UNCONFIRMED')
  }
  return { status: expected, publicSlug: r.public_slug, shareVersion: r.share_version }
}

/**
 * Publishes the version the operator reviewed (027's RPC refuses a stale one).
 * The caller passes a report id read with `kind = 'monthly'`, and the result is
 * checked to be that kind again, so this can never publish a scan report.
 */
export async function publishMonthlyReport(input: { accountId: string; clientId: string; reportId: string; reviewedVersionId: string }) {
  const [row] = await db()`select public.publish_client_report_latest(
    p_report_id => ${input.reportId}::uuid, p_account_id => ${input.accountId}::uuid,
    p_client_id => ${input.clientId}::uuid, p_reviewed_version_id => ${input.reviewedVersionId}::uuid) as result`
  return publication(row?.result, 'published')
}

/** Revokes the share link (027's RPC also rotates the slug, so the old link stays dead). */
export async function revokeMonthlyReport(input: { accountId: string; clientId: string; reportId: string }) {
  const [row] = await db()`select public.revoke_client_report(
    p_report_id => ${input.reportId}::uuid, p_account_id => ${input.accountId}::uuid, p_client_id => ${input.clientId}::uuid) as result`
  return publication(row?.result, 'revoked')
}
