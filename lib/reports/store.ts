import 'server-only'

import { createServiceSupabaseClient } from '@/lib/supabase-server'
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

export interface ReportAccountCommercialState {
  readonly id: string
  readonly plan: string
  readonly status: string
  readonly stripe_subscription_id: string | null
  readonly trial_ends_at: string | null
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

function throwOnError(error: DatabaseError | null) {
  if (error) throw new ReportStoreError(error)
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null
  return (value as T | null) ?? null
}

function mapScan(value: unknown): StoredReportScanInput | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string'
    || typeof value.account_id !== 'string'
    || typeof value.domain !== 'string'
    || typeof value.created_at !== 'string'
    || typeof value.score !== 'number'
    || typeof value.grade !== 'string'
  ) return null

  return {
    id: value.id,
    accountId: value.account_id,
    domain: value.domain,
    createdAt: value.created_at,
    score: value.score,
    grade: value.grade,
    results: value.results,
  }
}

function versionRpcArgs(input: ReportVersionWriteInput) {
  return {
    p_account_id: input.accountId,
    p_client_id: input.clientId,
    p_source_scan_id: input.sourceScanId,
    p_previous_scan_id: input.previousScanId,
    p_locale: input.locale,
    p_executive_summary: input.executiveSummary,
    p_snapshot_schema_version: input.snapshotSchemaVersion,
    p_snapshot: input.snapshot,
    p_created_by: input.createdBy,
  }
}

export async function loadOwnedReportClient(input: {
  accountId: string
  clientId: string
}): Promise<OwnedReportClient | null> {
  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('clients')
    .select('id,account_id,brand_name,domain')
    .eq('account_id', input.accountId)
    .eq('id', input.clientId)
    .maybeSingle()

  throwOnError(error)
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

  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('scans')
    .select('id,account_id,domain,created_at,score,grade,results')
    .eq('account_id', input.accountId)
    .eq('id', input.scanId)
    .maybeSingle()

  throwOnError(error)
  const scan = mapScan(data)
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

  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('scans')
    .select('id,account_id,domain,created_at,score,grade,results')
    .eq('account_id', input.accountId)
    .in('domain', [normalizedDomain, `www.${normalizedDomain}`])
    .lt('created_at', input.currentScan.createdAt)
    .order('created_at', { ascending: false })
    .limit(25)

  throwOnError(error)
  const candidates = Array.isArray(data) ? data.map(mapScan).filter(scan => scan !== null) : []
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

  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('agent_recommendations')
    .select('id,category,priority,recommendation,impact_score')
    .eq('scan_id', input.scanId)
    .order('priority')
    .order('impact_score', { ascending: false })

  throwOnError(error)
  if (!Array.isArray(data)) return []
  return data.flatMap((value): ReportRecommendationInput[] => {
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
  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('account_report_branding')
    .select('*')
    .eq('account_id', input.accountId)
    .maybeSingle()

  throwOnError(error)
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
    createdAt: typeof data.created_at === 'string' ? data.created_at : undefined,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : undefined,
  }
}

export async function upsertReportBranding(input: {
  accountId: string
  updatedBy: string | null
  branding: ReportBrandingInput
}): Promise<ReportBrandingRow | null> {
  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('account_report_branding')
    .upsert({
      account_id: input.accountId,
      agency_name: input.branding.agencyName,
      logo_url: input.branding.logoUrl,
      primary_color: input.branding.primaryColor,
      contact_label: input.branding.contactLabel,
      contact_url: input.branding.contactUrl,
      updated_by: input.updatedBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id' })
    .select('*')
    .single()

  throwOnError(error)
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
    createdAt: typeof data.created_at === 'string' ? data.created_at : undefined,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : undefined,
  }
}

async function callReportRpc(name: string, args: Record<string, unknown>): Promise<ClientReportRow | null> {
  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase.rpc(name, args)
  throwOnError(error)
  return firstRow<ClientReportRow>(data)
}

async function callReportVersionRpc(
  name: 'create_client_report_with_version' | 'append_client_report_version',
  args: Record<string, unknown>,
): Promise<ClientReportVersionMutationResult | null> {
  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase.rpc(name, args)
  throwOnError(error)
  const result = firstRow<unknown>(data)
  if (!isRecord(result) || !isRecord(result.report) || !isRecord(result.version)) return null
  return {
    report: result.report as unknown as ClientReportRow,
    version: result.version as unknown as ClientReportVersionRow,
  }
}

export function createClientReport(input: ReportVersionWriteInput) {
  return callReportVersionRpc('create_client_report_with_version', versionRpcArgs(input))
}

export function appendClientReportVersion(input: ReportVersionWriteInput & { reportId: string }) {
  return callReportVersionRpc('append_client_report_version', {
    p_report_id: input.reportId,
    ...versionRpcArgs(input),
  })
}

function tenantReportRpc(
  name: 'publish_client_report_latest' | 'revoke_client_report' | 'rotate_client_report_link',
  input: { accountId: string; clientId: string; reportId: string },
) {
  return callReportRpc(name, {
    p_report_id: input.reportId,
    p_account_id: input.accountId,
    p_client_id: input.clientId,
  })
}

export function publishClientReportLatest(input: { accountId: string; clientId: string; reportId: string }) {
  return tenantReportRpc('publish_client_report_latest', input)
}

export function revokeClientReport(input: { accountId: string; clientId: string; reportId: string }) {
  return tenantReportRpc('revoke_client_report', input)
}

export function rotateClientReportLink(input: { accountId: string; clientId: string; reportId: string }) {
  return tenantReportRpc('rotate_client_report_link', input)
}

function exactOwnedReport(
  data: unknown,
  expected: { accountId: string; reportId: string; clientId?: string },
): ClientReportRow | null {
  const report = firstRow<ClientReportRow>(data)
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
  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('client_reports')
    .select('*')
    .eq('account_id', input.accountId)
    .eq('id', input.reportId)
    .maybeSingle()

  throwOnError(error)
  return exactOwnedReport(data, input)
}

export async function loadOwnedClientReport(input: {
  accountId: string
  clientId: string
  reportId: string
}): Promise<ClientReportRow | null> {
  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('client_reports')
    .select('*')
    .eq('account_id', input.accountId)
    .eq('client_id', input.clientId)
    .eq('id', input.reportId)
    .maybeSingle()

  throwOnError(error)
  return exactOwnedReport(data, input)
}

export async function listClientReports(input: {
  accountId: string
  clientId: string
}): Promise<ReadonlyArray<ClientReportRow>> {
  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('client_reports')
    .select('*')
    .eq('account_id', input.accountId)
    .eq('client_id', input.clientId)
    .order('created_at', { ascending: false })

  throwOnError(error)
  return (Array.isArray(data) ? data : []) as ClientReportRow[]
}

export async function listClientReportVersions(input: {
  accountId: string
  clientId: string
  reportId: string
}): Promise<ReadonlyArray<ClientReportVersionRow>> {
  const supabase = await createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('client_report_versions')
    .select('*')
    .eq('account_id', input.accountId)
    .eq('client_id', input.clientId)
    .eq('report_id', input.reportId)
    .order('version_number', { ascending: false })

  throwOnError(error)
  return (Array.isArray(data) ? data : []) as ClientReportVersionRow[]
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
  const supabase = await createServiceSupabaseClient()

  const { data: reportData, error: reportError } = await supabase
    .from('client_reports')
    .select('*')
    .eq('public_slug', input.publicSlug)
    .eq('share_version', input.shareVersion)
    .eq('status', 'published')
    .maybeSingle()

  throwOnError(reportError)
  const report = firstRow<ClientReportRow>(reportData)
  if (!report?.published_version_id) return null

  const { data: versionData, error: versionError } = await supabase
    .from('client_report_versions')
    .select('*')
    .eq('id', report.published_version_id)
    .eq('report_id', report.id)
    .eq('account_id', report.account_id)
    .eq('client_id', report.client_id)
    .maybeSingle()

  throwOnError(versionError)
  const version = firstRow<ClientReportVersionRow>(versionData)
  if (!version) return null

  const { data: accountData, error: accountError } = await supabase
    .from('accounts')
    .select('id,plan,status,stripe_subscription_id,trial_ends_at')
    .eq('id', report.account_id)
    .maybeSingle()

  throwOnError(accountError)
  const account = firstRow<ReportAccountCommercialState>(accountData)
  return account ? { report, version, account } : null
}

async function incrementPublicCounter(
  name: 'increment_client_report_view' | 'increment_client_report_cta_click',
  input: { publicSlug: string; shareVersion: number },
) {
  try {
    const supabase = await createServiceSupabaseClient()
    await supabase.rpc(name, {
      p_public_slug: input.publicSlug,
      p_share_version: input.shareVersion,
    })
  } catch {
    // Public analytics are deliberately best-effort and never block rendering/redirects.
  }
}

export async function incrementClientReportView(input: { publicSlug: string; shareVersion: number }) {
  await incrementPublicCounter('increment_client_report_view', input)
}

export async function incrementClientReportCtaClick(input: { publicSlug: string; shareVersion: number }) {
  await incrementPublicCounter('increment_client_report_cta_click', input)
}
