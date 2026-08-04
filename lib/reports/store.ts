import 'server-only'

import { db } from '@/lib/db'
import { normalizeReportDomain, selectPreviousReportScan } from './comparison'
import type {
  ClientReportSnapshotV1,
  ReportBrandingInput,
  ReportLocale,
  ReportRecommendationInput,
  ReportScanInput,
  ReportStatus,
} from './types'

type DatabaseError = { message: string; code?: string }

export class ReportStoreError extends Error {
  readonly code: string | undefined

  constructor(error: DatabaseError) {
    super(error.message)
    this.name = 'ReportStoreError'
    this.code = error.code
  }
}

export interface OwnedReportClient {
  readonly id: string
  readonly accountId: string
  readonly name: string
  readonly domain: string
}

export interface StoredReportScanInput extends ReportScanInput {
  readonly id: string
}

export interface ReportBrandingRow extends ReportBrandingInput {
  readonly accountId: string
  readonly updatedBy: string | null
  readonly createdAt?: string
  readonly updatedAt?: string
}

export interface ClientReportRow {
  readonly id: string
  readonly account_id: string
  readonly client_id: string
  readonly status: ReportStatus
  readonly public_slug: string
  readonly share_version: number
  readonly latest_version_id: string | null
  readonly published_version_id: string | null
  readonly view_count: number
  readonly cta_click_count: number
  readonly first_viewed_at: string | null
  readonly last_viewed_at: string | null
  readonly published_at: string | null
  readonly revoked_at: string | null
  readonly created_by: string | null
  readonly created_at: string
  readonly updated_at: string
}

export interface ClientReportVersionRow {
  readonly id: string
  readonly report_id: string
  readonly account_id: string
  readonly client_id: string
  readonly version_number: number
  readonly source_scan_id: string | null
  readonly previous_scan_id: string | null
  readonly locale: ReportLocale
  readonly executive_summary: string
  readonly snapshot_schema_version: 1
  readonly snapshot: unknown
  readonly created_by: string | null
  readonly created_at: string
}

export interface ClientReportVersionMutationResult {
  readonly report: ClientReportRow
  readonly version: ClientReportVersionRow
}

export interface AppendClientReportVersionMutationResult extends ClientReportVersionMutationResult {
  readonly publishedVersion: ClientReportVersionRow | null
  readonly previousPublishedVersionId: string | null
}

export interface PublishedClientReportMutationResult {
  readonly report: ClientReportRow
  readonly latestVersion: ClientReportVersionRow
  readonly publishedVersion: ClientReportVersionRow
}

export interface ClientReportMutationResult {
  readonly report: ClientReportRow
  readonly latestVersion: ClientReportVersionRow
  readonly publishedVersion: ClientReportVersionRow | null
}

export interface ReportAccountCommercialState {
  readonly id: string
  readonly plan: string
  readonly status: string
  readonly stripe_subscription_id: string | null
  readonly trial_ends_at: string | null
  readonly override_plan: string | null
  readonly override_expires_at: string | Date | null
}

export interface ReportVersionWriteInput {
  readonly accountId: string
  readonly clientId: string
  readonly sourceScanId: string
  readonly previousScanId: string | null
  readonly locale: ReportLocale
  readonly executiveSummary: string
  readonly snapshotSchemaVersion: 1
  readonly snapshot: ClientReportSnapshotV1
  readonly createdBy: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null
  return (value as T | null) ?? null
}

// Every timestamptz column read directly from a table (as opposed to via a
// jsonb RPC payload, where to_jsonb() already stringified it) comes back from
// @neondatabase/serverless as a JS `Date`, not a string — see lib/tier.ts and
// lib/types.ts's Account type for the same gotcha documented against
// Supabase-era code that assumed a string. Every ISO string this module hands
// out (and every `typeof x === 'string'` check downstream, e.g.
// resolvePublishedClientReport's validTimestamp()) depends on this
// normalization running on every direct read.
function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string') return value
  return null
}

function toReportStoreError(err: unknown): ReportStoreError {
  if (err instanceof ReportStoreError) return err
  if (err instanceof Error) {
    const rawCode = (err as unknown as { code?: unknown }).code
    const code = typeof rawCode === 'string' ? rawCode : undefined
    return new ReportStoreError({ message: err.message, code })
  }
  return new ReportStoreError({ message: String(err) })
}

// Neon throws on a failed query where supabase-js resolved { data, error } —
// every direct query in this module runs through here so a thrown query
// becomes a ReportStoreError instead of an unwrapped driver exception, and so
// a failure can never be mistaken for a successful empty result. Takes a
// thunk rather than a bare promise: `runQuery(sql\`...\`)` would evaluate the
// tagged template — and any exception it throws synchronously — as an
// argument, before this function's own try/catch is even entered. Wrapping
// it in `() => sql\`...\`` keeps that evaluation inside the try.
async function runQuery<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query()
  } catch (err) {
    throw toReportStoreError(err)
  }
}

function mapScan(value: unknown): StoredReportScanInput | null {
  if (!isRecord(value)) return null
  const createdAt = toIsoString(value.created_at)
  if (
    typeof value.id !== 'string'
    || typeof value.account_id !== 'string'
    || typeof value.domain !== 'string'
    || createdAt === null
    || typeof value.score !== 'number'
    || typeof value.grade !== 'string'
  ) return null

  return {
    id: value.id,
    accountId: value.account_id,
    domain: value.domain,
    createdAt,
    score: value.score,
    grade: value.grade,
    results: value.results,
  }
}

export async function loadOwnedReportClient(input: {
  accountId: string
  clientId: string
}): Promise<OwnedReportClient | null> {
  const sql = db()
  const rows = await runQuery(() => sql`
    select id, account_id, brand_name, domain
    from clients
    where account_id = ${input.accountId} and id = ${input.clientId}
    limit 1
  `)
  const data = rows[0]
  if (!isRecord(data)
    || typeof data.id !== 'string'
    || typeof data.account_id !== 'string'
    || typeof data.brand_name !== 'string'
    || typeof data.domain !== 'string') return null

  const domain = normalizeReportDomain(data.domain)
  if (!domain || data.account_id !== input.accountId) return null
  return { id: data.id, accountId: data.account_id, name: data.brand_name, domain }
}

export async function loadOwnedReportScan(input: {
  accountId: string
  scanId: string
  clientDomain: string
}): Promise<StoredReportScanInput | null> {
  const expectedDomain = normalizeReportDomain(input.clientDomain)
  if (!expectedDomain) return null

  const sql = db()
  // scans.score is numeric(5,2); cast to float8 or the driver returns it as a
  // text string (its default, precision-safe parse for numeric), which would
  // fail mapScan's `typeof value.score === 'number'` gate on every real scan.
  const rows = await runQuery(() => sql`
    select id, account_id, domain, created_at, score::float8 as score, grade, results
    from scans
    where account_id = ${input.accountId} and id = ${input.scanId}
    limit 1
  `)
  const scan = mapScan(rows[0])
  if (!scan
    || scan.accountId !== input.accountId
    || normalizeReportDomain(scan.domain) !== expectedDomain) return null
  return scan
}

export async function loadPreviousReportScan(input: {
  accountId: string
  currentScan: ReportScanInput
}): Promise<StoredReportScanInput | null> {
  const normalizedDomain = normalizeReportDomain(input.currentScan.domain)
  if (!normalizedDomain || input.currentScan.accountId !== input.accountId) return null

  const sql = db()
  const rows = await runQuery(() => sql`
    select id, account_id, domain, created_at, score::float8 as score, grade, results
    from scans
    where account_id = ${input.accountId}
      and domain in (${normalizedDomain}, ${`www.${normalizedDomain}`})
      and created_at < ${input.currentScan.createdAt}::timestamptz
    order by created_at desc
    limit 25
  `)
  const candidates = rows.map(mapScan).filter((scan): scan is StoredReportScanInput => scan !== null)
  const selected = selectPreviousReportScan(input.currentScan, candidates)
  return candidates.find(candidate => candidate === selected) ?? null
}

export async function loadReportRecommendations(input: {
  accountId: string
  scanId: string
  clientDomain: string
}): Promise<ReadonlyArray<ReportRecommendationInput>> {
  const ownedScan = await loadOwnedReportScan(input)
  if (!ownedScan) return []

  const sql = db()
  const rows = await runQuery(() => sql`
    select id, category, priority, recommendation, impact_score
    from agent_recommendations
    where scan_id = ${input.scanId}
    order by priority, impact_score desc
  `)
  return rows.flatMap((value): ReportRecommendationInput[] => {
    if (!isRecord(value)
      || typeof value.category !== 'string'
      || typeof value.recommendation !== 'string'
      || !['high', 'medium', 'low'].includes(String(value.priority))) return []

    const expectedImpact = value.priority as ReportRecommendationInput['expectedImpact']
    return [{
      key: value.category,
      title: value.category,
      rationale: value.recommendation,
      expectedImpact,
      nextStep: value.recommendation,
    }]
  })
}

export async function loadReportBranding(input: {
  accountId: string
}): Promise<ReportBrandingRow | null> {
  const sql = db()
  const rows = await runQuery(() => sql`
    select account_id, agency_name, logo_url, primary_color, contact_label, contact_url,
           updated_by, created_at, updated_at
    from account_report_branding
    where account_id = ${input.accountId}
    limit 1
  `)
  const data = rows[0]
  if (!isRecord(data)
    || data.account_id !== input.accountId
    || typeof data.agency_name !== 'string'
    || typeof data.primary_color !== 'string') return null

  return {
    accountId: data.account_id,
    agencyName: data.agency_name,
    logoUrl: typeof data.logo_url === 'string' ? data.logo_url : null,
    primaryColor: data.primary_color,
    contactLabel: typeof data.contact_label === 'string' ? data.contact_label : null,
    contactUrl: typeof data.contact_url === 'string' ? data.contact_url : null,
    updatedBy: typeof data.updated_by === 'string' ? data.updated_by : null,
    createdAt: toIsoString(data.created_at) ?? undefined,
    updatedAt: toIsoString(data.updated_at) ?? undefined,
  }
}

export async function upsertReportBranding(input: {
  accountId: string
  updatedBy: string | null
  branding: ReportBrandingInput
}): Promise<ReportBrandingRow | null> {
  const sql = db()
  const rows = await runQuery(() => sql`
    insert into account_report_branding
      (account_id, agency_name, logo_url, primary_color, contact_label, contact_url, updated_by, updated_at)
    values
      (${input.accountId}, ${input.branding.agencyName}, ${input.branding.logoUrl},
       ${input.branding.primaryColor}, ${input.branding.contactLabel}, ${input.branding.contactUrl},
       ${input.updatedBy}, now())
    on conflict (account_id) do update set
      agency_name   = excluded.agency_name,
      logo_url      = excluded.logo_url,
      primary_color = excluded.primary_color,
      contact_label = excluded.contact_label,
      contact_url   = excluded.contact_url,
      updated_by    = excluded.updated_by,
      updated_at    = excluded.updated_at
    returning account_id, agency_name, logo_url, primary_color, contact_label, contact_url,
              updated_by, created_at, updated_at
  `)
  const data = rows[0]
  if (!isRecord(data)
    || data.account_id !== input.accountId
    || typeof data.agency_name !== 'string'
    || typeof data.primary_color !== 'string') return null
  return {
    accountId: data.account_id,
    agencyName: data.agency_name,
    logoUrl: typeof data.logo_url === 'string' ? data.logo_url : null,
    primaryColor: data.primary_color,
    contactLabel: typeof data.contact_label === 'string' ? data.contact_label : null,
    contactUrl: typeof data.contact_url === 'string' ? data.contact_url : null,
    updatedBy: typeof data.updated_by === 'string' ? data.updated_by : null,
    createdAt: toIsoString(data.created_at) ?? undefined,
    updatedAt: toIsoString(data.updated_at) ?? undefined,
  }
}

const REPORT_SLUG_PATTERN = /^[A-Za-z0-9_-]{32}$/
const REPORT_STATUSES = new Set<ReportStatus>(['draft', 'published', 'revoked'])

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function validatedRpcReport(
  value: unknown,
  expected: { accountId: string; clientId: string; reportId?: string },
): ClientReportRow | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || value.id.length === 0
    || value.account_id !== expected.accountId
    || value.client_id !== expected.clientId
    || (expected.reportId !== undefined && value.id !== expected.reportId)
    || typeof value.status !== 'string'
    || !REPORT_STATUSES.has(value.status as ReportStatus)
    || typeof value.public_slug !== 'string'
    || !REPORT_SLUG_PATTERN.test(value.public_slug)
    || typeof value.share_version !== 'number'
    || !Number.isInteger(value.share_version)
    || value.share_version <= 0
    || typeof value.latest_version_id !== 'string'
    || value.latest_version_id.length === 0
    || !isNullableString(value.published_version_id)
    || (typeof value.published_version_id === 'string' && value.published_version_id.length === 0)
    || typeof value.view_count !== 'number'
    || !Number.isInteger(value.view_count)
    || value.view_count < 0
    || typeof value.cta_click_count !== 'number'
    || !Number.isInteger(value.cta_click_count)
    || value.cta_click_count < 0
    || !isNullableString(value.first_viewed_at)
    || !isNullableString(value.last_viewed_at)
    || !isNullableString(value.published_at)
    || !isNullableString(value.revoked_at)
    || !isNullableString(value.created_by)
    || typeof value.created_at !== 'string'
    || typeof value.updated_at !== 'string') return null

  const hasPublishedVersion = value.published_version_id !== null
  const hasPublishedAt = value.published_at !== null
  if (hasPublishedVersion !== hasPublishedAt
    || (value.status === 'draft' && (hasPublishedVersion || value.revoked_at !== null))
    || (value.status === 'published' && (!hasPublishedVersion || value.revoked_at !== null))
    || (value.status === 'revoked' && value.revoked_at === null)) return null
  return value as unknown as ClientReportRow
}

function validatedRpcVersion(
  value: unknown,
  report: ClientReportRow,
): ClientReportVersionRow | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || value.report_id !== report.id
    || value.account_id !== report.account_id
    || value.client_id !== report.client_id
    || typeof value.version_number !== 'number'
    || !Number.isInteger(value.version_number)
    || value.version_number <= 0
    || !isNullableString(value.source_scan_id)
    || !isNullableString(value.previous_scan_id)
    || (value.locale !== 'en' && value.locale !== 'zh-HK')
    || typeof value.executive_summary !== 'string'
    || value.snapshot_schema_version !== 1
    || !isRecord(value.snapshot)
    || !isNullableString(value.created_by)
    || typeof value.created_at !== 'string') return null
  return value as unknown as ClientReportVersionRow
}

function rpcPayload(value: unknown): Record<string, unknown> | null {
  const result = firstRow<unknown>(value)
  return isRecord(result) ? result : null
}

export function validateCreateClientReportResult(
  value: unknown,
  expected: { accountId: string; clientId: string },
): ClientReportVersionMutationResult | null {
  const result = rpcPayload(value)
  if (!result) return null
  const report = validatedRpcReport(result.report, expected)
  if (!report || report.status !== 'draft' || report.published_version_id !== null || report.published_at !== null) return null
  const version = validatedRpcVersion(result.version, report)
  if (!version || report.latest_version_id !== version.id) return null
  return { report, version }
}

export function validateAppendClientReportResult(
  value: unknown,
  expected: { accountId: string; clientId: string; reportId: string },
): AppendClientReportVersionMutationResult | null {
  const result = rpcPayload(value)
  if (!result
    || !Object.hasOwn(result, 'published_version')
    || !Object.hasOwn(result, 'previous_published_version_id')
    || !isNullableString(result.previous_published_version_id)
    || (typeof result.previous_published_version_id === 'string' && result.previous_published_version_id.length === 0)) return null
  const report = validatedRpcReport(result.report, expected)
  if (!report) return null
  const version = validatedRpcVersion(result.version, report)
  const previousPublishedVersionId = result.previous_published_version_id
  if (!version
    || report.latest_version_id !== version.id
    || report.published_version_id !== previousPublishedVersionId
    || previousPublishedVersionId === version.id) return null

  let publishedVersion: ClientReportVersionRow | null = null
  if (report.published_version_id === null) {
    if (result.published_version !== null) return null
  } else {
    publishedVersion = validatedRpcVersion(result.published_version, report)
    if (!publishedVersion || publishedVersion.id !== report.published_version_id) return null
  }
  return { report, version, publishedVersion, previousPublishedVersionId }
}

function validatePublishedClientReportResult(
  value: unknown,
  expected: { accountId: string; clientId: string; reportId: string },
  requireLatestPublished: boolean,
): PublishedClientReportMutationResult | null {
  const result = rpcPayload(value)
  if (!result
    || !Object.hasOwn(result, 'latest_version')
    || !Object.hasOwn(result, 'published_version')) return null
  const report = validatedRpcReport(result.report, expected)
  if (!report || report.status !== 'published' || report.published_version_id === null) return null
  const latestVersion = validatedRpcVersion(result.latest_version, report)
  const publishedVersion = validatedRpcVersion(result.published_version, report)
  if (!latestVersion
    || latestVersion.id !== report.latest_version_id
    || !publishedVersion
    || publishedVersion.id !== report.published_version_id
    || (requireLatestPublished && latestVersion.id !== publishedVersion.id)) return null
  return { report, latestVersion, publishedVersion }
}

export function validatePublishClientReportResult(
  value: unknown,
  expected: { accountId: string; clientId: string; reportId: string },
): PublishedClientReportMutationResult | null {
  return validatePublishedClientReportResult(value, expected, true)
}

export function validateRotateClientReportResult(
  value: unknown,
  expected: { accountId: string; clientId: string; reportId: string },
): PublishedClientReportMutationResult | null {
  return validatePublishedClientReportResult(value, expected, false)
}

export function validateRevokeClientReportResult(
  value: unknown,
  expected: { accountId: string; clientId: string; reportId: string },
): ClientReportMutationResult | null {
  const result = rpcPayload(value)
  if (!result
    || !Object.hasOwn(result, 'latest_version')
    || !Object.hasOwn(result, 'published_version')) return null
  const report = validatedRpcReport(result.report, expected)
  if (!report || report.status !== 'revoked') return null
  const latestVersion = validatedRpcVersion(result.latest_version, report)
  if (!latestVersion || latestVersion.id !== report.latest_version_id) return null

  let publishedVersion: ClientReportVersionRow | null = null
  if (report.published_version_id === null) {
    if (result.published_version !== null) return null
  } else {
    publishedVersion = validatedRpcVersion(result.published_version, report)
    if (!publishedVersion || publishedVersion.id !== report.published_version_id) return null
  }
  return { report, latestVersion, publishedVersion }
}

// Neon's driver is tagged-template only — sql(name) throws — so the generic
// `reportRpcData(name, args)` dispatcher this replaced cannot exist anymore.
// Below are seven explicit calls, one per function in
// supabase/migrations/027_client_report_snapshots.sql, using named-argument
// notation (`p_foo => value`) rather than positional so a parameter reorder in
// this file can't silently transpose two same-typed columns — the same
// approach app/api/stripe/webhook/route.ts uses for apply_stripe_account_event.

export async function createClientReport(input: ReportVersionWriteInput) {
  const sql = db()
  const rows = await runQuery(() => sql`
    select create_client_report_with_version(
      p_account_id              => ${input.accountId}::uuid,
      p_client_id               => ${input.clientId}::uuid,
      p_source_scan_id          => ${input.sourceScanId}::uuid,
      p_previous_scan_id        => ${input.previousScanId}::uuid,
      p_locale                  => ${input.locale},
      p_executive_summary       => ${input.executiveSummary},
      p_snapshot_schema_version => ${input.snapshotSchemaVersion}::int,
      p_snapshot                => ${JSON.stringify(input.snapshot)}::jsonb,
      p_created_by              => ${input.createdBy}::uuid
    ) as result
  `)
  const data = rows[0]?.result ?? null
  return validateCreateClientReportResult(data, input)
}

export async function appendClientReportVersion(input: ReportVersionWriteInput & { reportId: string }) {
  const sql = db()
  const rows = await runQuery(() => sql`
    select append_client_report_version(
      p_report_id               => ${input.reportId}::uuid,
      p_account_id              => ${input.accountId}::uuid,
      p_client_id               => ${input.clientId}::uuid,
      p_source_scan_id          => ${input.sourceScanId}::uuid,
      p_previous_scan_id        => ${input.previousScanId}::uuid,
      p_locale                  => ${input.locale},
      p_executive_summary       => ${input.executiveSummary},
      p_snapshot_schema_version => ${input.snapshotSchemaVersion}::int,
      p_snapshot                => ${JSON.stringify(input.snapshot)}::jsonb,
      p_created_by              => ${input.createdBy}::uuid
    ) as result
  `)
  const data = rows[0]?.result ?? null
  return validateAppendClientReportResult(data, input)
}

export async function publishClientReportLatest(input: {
  accountId: string
  clientId: string
  reportId: string
  reviewedVersionId: string
}) {
  const sql = db()
  const rows = await runQuery(() => sql`
    select publish_client_report_latest(
      p_report_id           => ${input.reportId}::uuid,
      p_account_id          => ${input.accountId}::uuid,
      p_client_id           => ${input.clientId}::uuid,
      p_reviewed_version_id => ${input.reviewedVersionId}::uuid
    ) as result
  `)
  const data = rows[0]?.result ?? null
  return validatePublishClientReportResult(data, input)
}

export async function revokeClientReport(input: { accountId: string; clientId: string; reportId: string }) {
  const sql = db()
  const rows = await runQuery(() => sql`
    select revoke_client_report(
      p_report_id  => ${input.reportId}::uuid,
      p_account_id => ${input.accountId}::uuid,
      p_client_id  => ${input.clientId}::uuid
    ) as result
  `)
  const data = rows[0]?.result ?? null
  return validateRevokeClientReportResult(data, input)
}

export async function rotateClientReportLink(input: { accountId: string; clientId: string; reportId: string }) {
  const sql = db()
  const rows = await runQuery(() => sql`
    select rotate_client_report_link(
      p_report_id  => ${input.reportId}::uuid,
      p_account_id => ${input.accountId}::uuid,
      p_client_id  => ${input.clientId}::uuid
    ) as result
  `)
  const data = rows[0]?.result ?? null
  return validateRotateClientReportResult(data, input)
}

// client_reports.view_count / cta_click_count are bigint so a direct SELECT
// (unlike the RPCs above, whose jsonb payloads already stringified through
// to_jsonb()) returns them as text, the driver's precision-safe default for
// int8 — cast to int here so ClientReportRow.view_count stays a real number.
// The timestamptz columns have the same issue in the other direction: the
// driver returns those as JS `Date`, so every row is renormalized to an ISO
// string below (see toIsoString's comment).
const CLIENT_REPORT_TIMESTAMP_KEYS = [
  'first_viewed_at', 'last_viewed_at', 'published_at', 'revoked_at', 'created_at', 'updated_at',
] as const

function normalizeClientReportRow(row: Record<string, unknown>): ClientReportRow {
  const normalized: Record<string, unknown> = { ...row }
  for (const key of CLIENT_REPORT_TIMESTAMP_KEYS) normalized[key] = toIsoString(normalized[key])
  return normalized as unknown as ClientReportRow
}

function normalizeClientReportRows(rows: ReadonlyArray<unknown>): ClientReportRow[] {
  return rows.filter(isRecord).map(normalizeClientReportRow)
}

function normalizeClientReportVersionRow(row: Record<string, unknown>): ClientReportVersionRow {
  return { ...row, created_at: toIsoString(row.created_at) } as unknown as ClientReportVersionRow
}

function normalizeClientReportVersionRows(rows: ReadonlyArray<unknown>): ClientReportVersionRow[] {
  return rows.filter(isRecord).map(normalizeClientReportVersionRow)
}

function exactOwnedReport(
  rows: ReadonlyArray<ClientReportRow>,
  expected: { accountId: string; reportId: string; clientId?: string },
): ClientReportRow | null {
  const report = rows[0]
  if (!report
    || report.account_id !== expected.accountId
    || report.id !== expected.reportId
    || typeof report.client_id !== 'string'
    || (expected.clientId !== undefined && report.client_id !== expected.clientId)) return null
  return report
}

export async function loadOwnedClientReportById(input: {
  accountId: string
  reportId: string
}): Promise<ClientReportRow | null> {
  const sql = db()
  const rows = await runQuery(() => sql`
    select id, account_id, client_id, status, public_slug, share_version,
           latest_version_id, published_version_id, view_count::int as view_count,
           cta_click_count::int as cta_click_count, first_viewed_at, last_viewed_at,
           published_at, revoked_at, created_by, created_at, updated_at
    from client_reports
    where account_id = ${input.accountId} and id = ${input.reportId}
    limit 1
  `)
  return exactOwnedReport(normalizeClientReportRows(rows), input)
}

export async function loadOwnedClientReport(input: {
  accountId: string
  clientId: string
  reportId: string
}): Promise<ClientReportRow | null> {
  const sql = db()
  const rows = await runQuery(() => sql`
    select id, account_id, client_id, status, public_slug, share_version,
           latest_version_id, published_version_id, view_count::int as view_count,
           cta_click_count::int as cta_click_count, first_viewed_at, last_viewed_at,
           published_at, revoked_at, created_by, created_at, updated_at
    from client_reports
    where account_id = ${input.accountId} and client_id = ${input.clientId} and id = ${input.reportId}
    limit 1
  `)
  return exactOwnedReport(normalizeClientReportRows(rows), input)
}

export async function listClientReports(input: {
  accountId: string
  clientId: string
}): Promise<ReadonlyArray<ClientReportRow>> {
  const sql = db()
  const rows = await runQuery(() => sql`
    select id, account_id, client_id, status, public_slug, share_version,
           latest_version_id, published_version_id, view_count::int as view_count,
           cta_click_count::int as cta_click_count, first_viewed_at, last_viewed_at,
           published_at, revoked_at, created_by, created_at, updated_at
    from client_reports
    where account_id = ${input.accountId} and client_id = ${input.clientId}
    order by created_at desc
  `)
  return normalizeClientReportRows(rows)
}

export async function listClientReportVersions(input: {
  accountId: string
  clientId: string
  reportId: string
}): Promise<ReadonlyArray<ClientReportVersionRow>> {
  const sql = db()
  const rows = await runQuery(() => sql`
    select id, report_id, account_id, client_id, version_number, source_scan_id,
           previous_scan_id, locale, executive_summary, snapshot_schema_version,
           snapshot, created_by, created_at
    from client_report_versions
    where account_id = ${input.accountId} and client_id = ${input.clientId} and report_id = ${input.reportId}
    order by version_number desc
  `)
  return normalizeClientReportVersionRows(rows)
}

export async function resolvePublicClientReport(input: {
  publicSlug: string
  shareVersion: number
}): Promise<{
  report: ClientReportRow
  version: ClientReportVersionRow
  account: ReportAccountCommercialState
} | null> {
  if (!input.publicSlug || !Number.isInteger(input.shareVersion) || input.shareVersion <= 0) return null
  const sql = db()

  const reportRows = await runQuery(() => sql`
    select id, account_id, client_id, status, public_slug, share_version,
           latest_version_id, published_version_id, view_count::int as view_count,
           cta_click_count::int as cta_click_count, first_viewed_at, last_viewed_at,
           published_at, revoked_at, created_by, created_at, updated_at
    from client_reports
    where public_slug = ${input.publicSlug}
      and share_version = ${input.shareVersion}::int
      and status = 'published'
    limit 1
  `)
  // A revoked report, an unknown slug, and a stale share_version all land
  // here identically — none of them distinguish themselves from the others,
  // which is what keeps the public 404 neutral.
  const report = normalizeClientReportRows(reportRows)[0]
  if (!report?.published_version_id) return null

  const versionRows = await runQuery(() => sql`
    select id, report_id, account_id, client_id, version_number, source_scan_id,
           previous_scan_id, locale, executive_summary, snapshot_schema_version,
           snapshot, created_by, created_at
    from client_report_versions
    where id = ${report.published_version_id}
      and report_id = ${report.id}
      and account_id = ${report.account_id}
      and client_id = ${report.client_id}
    limit 1
  `)
  const version = normalizeClientReportVersionRows(versionRows)[0]
  if (!version) return null

  const accountRows = await runQuery(() => sql`
    select id, plan, status, stripe_subscription_id, trial_ends_at, override_plan, override_expires_at
    from accounts
    where id = ${report.account_id}
    limit 1
  `)
  const account = accountRows[0] as ReportAccountCommercialState | undefined
  return account ? { report, version, account } : null
}

function logPublicCounterFailure(reason: string) {
  console.warn('[public-report] counter update failed', { reason })
}

export async function incrementClientReportView(input: { publicSlug: string; shareVersion: number }): Promise<void> {
  try {
    const sql = db()
    await sql`
      select increment_client_report_view(
        p_public_slug   => ${input.publicSlug},
        p_share_version => ${input.shareVersion}::int
      )
    `
  } catch {
    logPublicCounterFailure('query')
  }
}

export async function incrementClientReportCtaClick(input: { publicSlug: string; shareVersion: number }): Promise<void> {
  try {
    const sql = db()
    await sql`
      select increment_client_report_cta_click(
        p_public_slug   => ${input.publicSlug},
        p_share_version => ${input.shareVersion}::int
      )
    `
  } catch {
    logPublicCounterFailure('query')
  }
}
