import 'server-only'

import { getProfile } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { ProfileWithAccount } from '@/lib/types'
import { normalizeReportBranding } from './branding'
import { polishReportSummary } from './ai'
import { buildReportShareUrl, prepareReportShareUrl } from './share'
import { buildClientReportSnapshot, replaceExecutiveSummary } from './snapshot'
import { buildDeterministicReportSummary } from './summary'
import {
  ReportStoreError,
  appendClientReportVersion,
  createClientReport,
  listClientReportVersions,
  listClientReports,
  loadOwnedClientReport,
  loadOwnedClientReportById,
  loadOwnedReportClient,
  loadOwnedReportScan,
  loadPreviousReportScan,
  loadReportBranding,
  loadReportRecommendations,
  publishClientReportLatest,
  revokeClientReport,
  rotateClientReportLink,
  upsertReportBranding,
  type ClientReportRow,
  type ClientReportVersionRow,
  type OwnedReportClient,
  type ReportBrandingRow,
} from './store'
import type { ChangeKind, ClientReportSnapshotV1, ReportBrandingInput, ReportLocale } from './types'

export type ReportServiceErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'client_reports_unavailable'
  | 'not_found'
  | 'conflict'
  | 'service_unavailable'

const STATUS_BY_CODE: Record<ReportServiceErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  client_reports_unavailable: 403,
  not_found: 404,
  conflict: 409,
  service_unavailable: 503,
}

export class ReportServiceError extends Error {
  readonly code: ReportServiceErrorCode
  readonly status: number

  constructor(code: ReportServiceErrorCode) {
    super(code)
    this.name = 'ReportServiceError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
  }
}

export function reportJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export function reportErrorResponse(error: unknown): Response {
  const safe = error instanceof ReportServiceError
    ? error
    : new ReportServiceError('service_unavailable')
  return reportJson({ error: safe.code }, safe.status)
}

export function requireClientReportEntitlement(profile: ProfileWithAccount): void {
  const entitlement = resolveCommercialEntitlement(profile.accounts)
  if (!entitlement.features.client_reports_online) {
    throw new ReportServiceError('client_reports_unavailable')
  }
}

async function authenticatedProfile(): Promise<ProfileWithAccount> {
  let profile: ProfileWithAccount | null
  try {
    profile = await getProfile()
  } catch {
    throw new ReportServiceError('service_unavailable')
  }
  if (!profile) throw new ReportServiceError('unauthorized')
  requireClientReportEntitlement(profile)
  return profile
}

function mapStoreError(error: ReportStoreError): ReportServiceError {
  if (/CLIENT_REPORT_(?:NOT_FOUND|SCAN_NOT_FOUND|PREVIOUS_SCAN_INVALID)/.test(error.message)) {
    return new ReportServiceError('not_found')
  }
  return new ReportServiceError('service_unavailable')
}

async function serviceOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ReportServiceError) throw error
    if (error instanceof ReportStoreError) throw mapStoreError(error)
    throw new ReportServiceError('service_unavailable')
  }
}

function brandingDto(row: ReportBrandingRow) {
  return {
    agencyName: row.agencyName,
    logoUrl: row.logoUrl,
    primaryColor: row.primaryColor,
    contactLabel: row.contactLabel,
    contactUrl: row.contactUrl,
  }
}

function reportOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://aeo.fimmick.com'
}

function exactVersions(
  versions: ReadonlyArray<ClientReportVersionRow>,
  report: ClientReportRow,
): ReadonlyArray<ClientReportVersionRow> {
  if (versions.some(version =>
    version.account_id !== report.account_id
    || version.client_id !== report.client_id
    || version.report_id !== report.id
  )) throw new ReportServiceError('not_found')
  return versions
}

function versionById(
  versions: ReadonlyArray<ClientReportVersionRow>,
  id: string | null,
): ClientReportVersionRow | null {
  if (!id) return null
  return versions.find(version => version.id === id) ?? null
}

function versionDto(version: ClientReportVersionRow | null) {
  if (!version) return null
  return {
    id: version.id,
    versionNumber: version.version_number,
    locale: version.locale,
    executiveSummary: version.executive_summary,
    sourceScanId: version.source_scan_id,
    previousScanId: version.previous_scan_id,
    createdAt: version.created_at,
  }
}

type ReportVersionState = {
  readonly latest: ClientReportVersionRow | null
  readonly published: ClientReportVersionRow | null
}

function resolvedReportVersions(
  report: ClientReportRow,
  versionsInput: ReadonlyArray<ClientReportVersionRow>,
): ReportVersionState {
  const versions = exactVersions(versionsInput, report)
  const latest = versionById(versions, report.latest_version_id)
  const published = versionById(versions, report.published_version_id)
  if ((report.latest_version_id && !latest) || (report.published_version_id && !published)) {
    throw new ReportServiceError('conflict')
  }
  return { latest, published }
}

function reportDto(
  report: ClientReportRow,
  versions: ReportVersionState,
  signedUrl?: string,
) {
  const dto: Record<string, unknown> = {
    id: report.id,
    clientId: report.client_id,
    status: report.status,
    latestVersionNumber: versions.latest?.version_number ?? null,
    publishedVersionNumber: versions.published?.version_number ?? null,
    latestVersion: versionDto(versions.latest),
    publishedAt: report.published_at,
    revokedAt: report.revoked_at,
    firstViewedAt: report.first_viewed_at,
    lastViewedAt: report.last_viewed_at,
    viewCount: report.view_count,
    ctaClickCount: report.cta_click_count,
    createdAt: report.created_at,
    updatedAt: report.updated_at,
  }
  if (signedUrl) dto.signedUrl = signedUrl
  return dto
}

function safeReportDto(
  report: ClientReportRow,
  versionsInput: ReadonlyArray<ClientReportVersionRow>,
  includeSignedUrl: boolean,
) {
  const versions = resolvedReportVersions(report, versionsInput)
  const signedUrl = includeSignedUrl && report.status === 'published' && versions.published
    ? buildReportShareUrl({
        origin: reportOrigin(),
        locale: versions.published.locale,
        slug: report.public_slug,
        shareVersion: report.share_version,
      })
    : undefined
  return reportDto(report, versions, signedUrl)
}
async function ownedClient(profile: ProfileWithAccount, clientId: string): Promise<OwnedReportClient> {
  const client = await loadOwnedReportClient({ accountId: profile.account_id, clientId })
  if (!client || client.accountId !== profile.account_id || client.id !== clientId) {
    throw new ReportServiceError('not_found')
  }
  return client
}

async function ownedReport(profile: ProfileWithAccount, reportId: string): Promise<{
  client: OwnedReportClient
  report: ClientReportRow
}> {
  const discovered = await loadOwnedClientReportById({ accountId: profile.account_id, reportId })
  if (!discovered
    || discovered.account_id !== profile.account_id
    || discovered.id !== reportId
    || typeof discovered.client_id !== 'string') {
    throw new ReportServiceError('not_found')
  }

  const client = await ownedClient(profile, discovered.client_id)
  const report = await loadOwnedClientReport({
    accountId: profile.account_id,
    clientId: client.id,
    reportId,
  })
  if (!report
    || report.account_id !== profile.account_id
    || report.client_id !== client.id
    || report.id !== reportId) {
    throw new ReportServiceError('not_found')
  }
  return { client, report }
}

async function reportSnapshot(input: {
  profile: ProfileWithAccount
  client: OwnedReportClient
  scanId: string
  locale: ReportLocale
  executiveSummary?: string
}): Promise<{
  snapshot: ClientReportSnapshotV1
  sourceScanId: string
  previousScanId: string | null
}> {
  const currentScan = await loadOwnedReportScan({
    accountId: input.profile.account_id,
    scanId: input.scanId,
    clientDomain: input.client.domain,
  })
  if (!currentScan
    || currentScan.accountId !== input.profile.account_id
    || currentScan.id !== input.scanId) {
    throw new ReportServiceError('not_found')
  }

  const previousScan = await loadPreviousReportScan({
    accountId: input.profile.account_id,
    currentScan,
  })
  if (previousScan && previousScan.accountId !== input.profile.account_id) {
    throw new ReportServiceError('not_found')
  }

  const [recommendations, branding] = await Promise.all([
    loadReportRecommendations({
      accountId: input.profile.account_id,
      scanId: currentScan.id,
      clientDomain: input.client.domain,
    }),
    loadReportBranding({ accountId: input.profile.account_id }),
  ])
  if (!branding) throw new ReportServiceError('conflict')
  if (branding.accountId !== input.profile.account_id) throw new ReportServiceError('not_found')

  let snapshot: ClientReportSnapshotV1
  try {
    snapshot = buildClientReportSnapshot({
      locale: input.locale,
      branding,
      client: input.client,
      currentScan,
      previousScan,
      recommendations,
    })
    if (input.executiveSummary !== undefined) {
      snapshot = replaceExecutiveSummary(snapshot, input.executiveSummary)
    }
  } catch {
    throw new ReportServiceError('invalid_request')
  }

  return {
    snapshot,
    sourceScanId: currentScan.id,
    previousScanId: previousScan?.id ?? null,
  }
}

async function versionsFor(report: ClientReportRow) {
  const versions = await listClientReportVersions({
    accountId: report.account_id,
    clientId: report.client_id,
    reportId: report.id,
  })
  return exactVersions(versions, report)
}

export async function getAuthenticatedReportBranding() {
  return serviceOperation(async () => {
    const profile = await authenticatedProfile()
    const branding = await loadReportBranding({ accountId: profile.account_id })
    if (!branding) return { branding: null }
    if (branding.accountId !== profile.account_id) throw new ReportServiceError('not_found')
    return { branding: brandingDto(branding) }
  })
}

export async function putAuthenticatedReportBranding(input: ReportBrandingInput) {
  return serviceOperation(async () => {
    const profile = await authenticatedProfile()
    let branding: ReportBrandingInput
    try {
      const normalized = normalizeReportBranding(input)
      branding = {
        agencyName: normalized.agencyName,
        logoUrl: normalized.logoUrl,
        primaryColor: normalized.primaryColor,
        contactLabel: normalized.contactLabel,
        contactUrl: normalized.contactUrl,
      }
    } catch {
      throw new ReportServiceError('invalid_request')
    }
    const saved = await upsertReportBranding({
      accountId: profile.account_id,
      updatedBy: profile.id,
      branding,
    })
    if (!saved) throw new ReportServiceError('service_unavailable')
    if (saved.accountId !== profile.account_id) throw new ReportServiceError('not_found')
    return { branding: brandingDto(saved) }
  })
}

export async function listAuthenticatedClientReports(clientId: string) {
  return serviceOperation(async () => {
    const profile = await authenticatedProfile()
    const client = await ownedClient(profile, clientId)
    const reports = await listClientReports({ accountId: profile.account_id, clientId: client.id })
    const result = await Promise.all(reports.map(async report => {
      if (report.account_id !== profile.account_id || report.client_id !== client.id) {
        throw new ReportServiceError('not_found')
      }
      return safeReportDto(report, await versionsFor(report), true)
    }))
    return { reports: result }
  })
}

export async function createAuthenticatedClientReport(input: {
  clientId: string
  scanId: string
  locale: ReportLocale
  executiveSummary?: string
}) {
  return serviceOperation(async () => {
    const profile = await authenticatedProfile()
    const client = await ownedClient(profile, input.clientId)
    const built = await reportSnapshot({ profile, client, ...input })
    const created = await createClientReport({
      accountId: profile.account_id,
      clientId: client.id,
      sourceScanId: built.sourceScanId,
      previousScanId: built.previousScanId,
      locale: input.locale,
      executiveSummary: built.snapshot.executiveSummary,
      snapshotSchemaVersion: built.snapshot.snapshotSchemaVersion,
      snapshot: built.snapshot,
      createdBy: profile.id,
    })
    if (!created) throw new ReportServiceError('service_unavailable')
    return {
      report: reportDto(created.report, { latest: created.version, published: null }),
    }
  })
}
export async function appendAuthenticatedClientReportVersion(input: {
  reportId: string
  locale: ReportLocale
  executiveSummary: string
}) {
  return serviceOperation(async () => {
    const profile = await authenticatedProfile()
    const context = await ownedReport(profile, input.reportId)
    const versions = resolvedReportVersions(context.report, await versionsFor(context.report))
    const latest = versions.latest
    if (!latest?.source_scan_id) throw new ReportServiceError('conflict')

    const existingSignedUrl = context.report.status === 'published' && versions.published
      ? prepareReportShareUrl(reportOrigin())({
          locale: versions.published.locale,
          slug: context.report.public_slug,
          shareVersion: context.report.share_version,
        })
      : undefined
    const built = await reportSnapshot({
      profile,
      client: context.client,
      scanId: latest.source_scan_id,
      locale: input.locale,
      executiveSummary: input.executiveSummary,
    })
    const updated = await appendClientReportVersion({
      reportId: context.report.id,
      accountId: profile.account_id,
      clientId: context.client.id,
      sourceScanId: built.sourceScanId,
      previousScanId: built.previousScanId,
      locale: input.locale,
      executiveSummary: built.snapshot.executiveSummary,
      snapshotSchemaVersion: built.snapshot.snapshotSchemaVersion,
      snapshot: built.snapshot,
      createdBy: profile.id,
    })
    if (!updated) throw new ReportServiceError('service_unavailable')
    return {
      report: reportDto(
        updated.report,
        { latest: updated.version, published: versions.published },
        existingSignedUrl,
      ),
    }
  })
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

const COMPARISON_STATES = new Set(['baseline', 'comparable', 'not_comparable'])
const CHANGE_KINDS = new Set<ChangeKind>(['improved', 'regressed', 'unchanged', 'added_coverage', 'lost_coverage', 'data_gap'])
const IMPACT_LEVELS = new Set(['high', 'medium', 'low'])

function isSnapshot(value: unknown): value is ClientReportSnapshotV1 {
  if (!isRecord(value)
    || value.snapshotSchemaVersion !== 1
    || (value.locale !== 'en' && value.locale !== 'zh-HK')
    || !isRecord(value.branding)
    || typeof value.branding.agencyName !== 'string'
    || !isNullableString(value.branding.logoUrl)
    || typeof value.branding.primaryColor !== 'string'
    || !isNullableString(value.branding.contactLabel)
    || !isNullableString(value.branding.contactUrl)
    || value.branding.attribution !== 'Powered by Fimmick AISO'
    || !isRecord(value.client)
    || typeof value.client.name !== 'string'
    || typeof value.client.domain !== 'string'
    || !isRecord(value.evidence)
    || typeof value.evidence.scanDate !== 'string'
    || typeof value.evidence.evidenceTimestamp !== 'string'
    || !isRecord(value.score)
    || typeof value.score.current !== 'number'
    || !Number.isFinite(value.score.current)
    || typeof value.score.grade !== 'string'
    || typeof value.score.comparisonState !== 'string'
    || !COMPARISON_STATES.has(value.score.comparisonState)
    || (value.score.previous !== undefined && (typeof value.score.previous !== 'number' || !Number.isFinite(value.score.previous)))
    || (value.score.delta !== undefined && (typeof value.score.delta !== 'number' || !Number.isFinite(value.score.delta)))
    || (value.score.previousScanDate !== undefined && typeof value.score.previousScanDate !== 'string')
    || !Array.isArray(value.changes)
    || !value.changes.every(change => isRecord(change)
      && typeof change.key === 'string'
      && typeof change.label === 'string'
      && typeof change.kind === 'string'
      && CHANGE_KINDS.has(change.kind as ChangeKind))
    || !Array.isArray(value.priorityFixes)
    || !value.priorityFixes.every(fix => isRecord(fix)
      && typeof fix.key === 'string'
      && typeof fix.title === 'string'
      && typeof fix.rationale === 'string'
      && typeof fix.expectedImpact === 'string'
      && IMPACT_LEVELS.has(fix.expectedImpact)
      && typeof fix.nextStep === 'string')
    || typeof value.executiveSummary !== 'string'
    || typeof value.methodology !== 'string') return false

  const score = value.score as {
    current: number
    comparisonState: string
    previous?: number
    delta?: number
    previousScanDate?: string
  }
  if (score.comparisonState === 'comparable') {
    return typeof score.previous === 'number'
      && typeof score.delta === 'number'
      && typeof score.previousScanDate === 'string'
      && score.delta === score.current - score.previous
  }
  return score.previous === undefined && score.delta === undefined && score.previousScanDate === undefined
}

function aiFacts(snapshot: ClientReportSnapshotV1) {
  const counts: Record<ChangeKind, number> = {
    improved: 0,
    regressed: 0,
    unchanged: 0,
    added_coverage: 0,
    lost_coverage: 0,
    data_gap: 0,
  }
  for (const change of snapshot.changes) counts[change.kind] += 1
  const delta = snapshot.score.delta
  return {
    locale: snapshot.locale,
    deterministicSummary: buildDeterministicReportSummary({
      locale: snapshot.locale,
      comparisonState: snapshot.score.comparisonState,
      currentScore: snapshot.score.current,
      delta,
      changes: snapshot.changes,
    }),
    currentScore: snapshot.score.current,
    previousScore: snapshot.score.previous,
    signedDelta: typeof delta === 'number' ? (delta >= 0 ? '+' : '') + String(delta) : undefined,
    comparisonState: snapshot.score.comparisonState,
    changeCounts: {
      improved: counts.improved,
      regressed: counts.regressed,
      unchanged: counts.unchanged,
      addedCoverage: counts.added_coverage,
      lostCoverage: counts.lost_coverage,
      dataGap: counts.data_gap,
    },
  }
}
export async function polishAuthenticatedClientReportSummary(reportId: string) {
  return serviceOperation(async () => {
    const profile = await authenticatedProfile()
    const context = await ownedReport(profile, reportId)
    const latest = versionById(await versionsFor(context.report), context.report.latest_version_id)
    if (!latest || !isSnapshot(latest.snapshot)) throw new ReportServiceError('conflict')
    return polishReportSummary(aiFacts(latest.snapshot))
  })
}

async function mutateReport(
  reportId: string,
  mutation: (input: { accountId: string; clientId: string; reportId: string }) => Promise<ClientReportRow | null>,
  mode: 'publish' | 'revoke' | 'rotate',
) {
  return serviceOperation(async () => {
    const profile = await authenticatedProfile()
    const context = await ownedReport(profile, reportId)
    const versions = resolvedReportVersions(context.report, await versionsFor(context.report))
    let responseVersions = versions
    let shareUrlBuilder: ReturnType<typeof prepareReportShareUrl> | undefined

    if (mode === 'publish') {
      if (!versions.latest) throw new ReportServiceError('conflict')
      shareUrlBuilder = prepareReportShareUrl(reportOrigin())
      responseVersions = { latest: versions.latest, published: versions.latest }
    } else if (mode === 'rotate') {
      if (context.report.status !== 'published' || !versions.published) {
        throw new ReportServiceError('conflict')
      }
      shareUrlBuilder = prepareReportShareUrl(reportOrigin())
    }

    const tuple = { accountId: profile.account_id, clientId: context.client.id, reportId: context.report.id }
    const report = await mutation(tuple)
    if (!report) throw new ReportServiceError('service_unavailable')
    const safe = reportDto(report, responseVersions)
    if (mode === 'revoke') return { report: safe }

    const published = responseVersions.published!
    return {
      report: safe,
      signedUrl: shareUrlBuilder!({
        locale: published.locale,
        slug: report.public_slug,
        shareVersion: report.share_version,
      }),
    }
  })
}
export function publishAuthenticatedClientReport(reportId: string) {
  return mutateReport(reportId, publishClientReportLatest, 'publish')
}

export function revokeAuthenticatedClientReport(reportId: string) {
  return mutateReport(reportId, revokeClientReport, 'revoke')
}

export function rotateAuthenticatedClientReportLink(reportId: string) {
  return mutateReport(reportId, rotateClientReportLink, 'rotate')
}
