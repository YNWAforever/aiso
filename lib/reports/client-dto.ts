import type {
  ChangeKind,
  ClientReportSnapshotV1,
  ReportBrandingInput,
  ReportStatus,
} from './types'

export interface ReportWorkspaceReport {
  id: string
  status: ReportStatus
  latestVersionNumber: number | null
  publishedVersionNumber: number | null
  publishedAt?: string | null
  firstViewedAt?: string | null
  lastViewedAt?: string | null
  viewCount?: number | null
  ctaClickCount?: number | null
  metricsUnavailable?: boolean
  signedUrl?: string
}

export interface ReportReviewArtifact {
  versionId: string
  versionNumber: number
  snapshot: ClientReportSnapshotV1
}

export interface ReportSaveResponse {
  report: ReportWorkspaceReport
  reviewArtifact: ReportReviewArtifact
}

type LifecycleResponse = {
  report: ReportWorkspaceReport
  signedUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isSafeAbsoluteUrl(value: string, protocols: ReadonlyArray<string>): boolean {
  if (value.length === 0 || value.length > 2048) return false
  try {
    const url = new URL(value)
    return protocols.includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

function isSafeReportUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2048) return false
  try {
    const url = new URL(value, 'https://report.invalid')
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username
      && !url.password
  } catch {
    return false
  }
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null
    || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
}

function isReportStatus(value: unknown): value is ReportStatus {
  return value === 'draft' || value === 'published' || value === 'revoked'
}

const CHANGE_KINDS = new Set<ChangeKind>([
  'improved',
  'regressed',
  'unchanged',
  'added_coverage',
  'lost_coverage',
  'data_gap',
])

export function parseClientReportSnapshot(value: unknown): ClientReportSnapshotV1 | null {
  if (!isRecord(value)
    || value.snapshotSchemaVersion !== 1
    || (value.locale !== 'en' && value.locale !== 'zh-HK')
    || !isRecord(value.branding)
    || typeof value.branding.agencyName !== 'string'
    || value.branding.agencyName.trim().length === 0
    || !isNullableString(value.branding.logoUrl)
    || (typeof value.branding.logoUrl === 'string'
      && !isSafeAbsoluteUrl(value.branding.logoUrl, ['https:']))
    || typeof value.branding.primaryColor !== 'string'
    || !/^#[0-9A-Fa-f]{6}$/.test(value.branding.primaryColor)
    || !isNullableString(value.branding.contactLabel)
    || !isNullableString(value.branding.contactUrl)
    || ((value.branding.contactLabel === null) !== (value.branding.contactUrl === null))
    || (typeof value.branding.contactUrl === 'string'
      && !isSafeAbsoluteUrl(value.branding.contactUrl, ['https:', 'mailto:']))
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
    || !['baseline', 'comparable', 'not_comparable'].includes(String(value.score.comparisonState))
    || !Array.isArray(value.changes)
    || !Array.isArray(value.priorityFixes)
    || typeof value.executiveSummary !== 'string'
    || typeof value.methodology !== 'string') return null

  if (value.score.previous !== undefined
    && (typeof value.score.previous !== 'number' || !Number.isFinite(value.score.previous))) return null
  if (value.score.delta !== undefined
    && (typeof value.score.delta !== 'number' || !Number.isFinite(value.score.delta))) return null
  if (value.score.previousScanDate !== undefined
    && typeof value.score.previousScanDate !== 'string') return null
  if (value.score.comparisonState === 'comparable') {
    if (typeof value.score.previous !== 'number'
      || typeof value.score.delta !== 'number'
      || typeof value.score.previousScanDate !== 'string'
      || value.score.delta !== value.score.current - value.score.previous) return null
  } else if (value.score.previous !== undefined
    || value.score.delta !== undefined
    || value.score.previousScanDate !== undefined) return null

  for (const change of value.changes) {
    if (!isRecord(change)
      || typeof change.key !== 'string'
      || typeof change.label !== 'string'
      || !CHANGE_KINDS.has(change.kind as ChangeKind)) return null
  }
  for (const fix of value.priorityFixes) {
    if (!isRecord(fix)
      || typeof fix.key !== 'string'
      || typeof fix.title !== 'string'
      || typeof fix.rationale !== 'string'
      || !['high', 'medium', 'low'].includes(String(fix.expectedImpact))
      || typeof fix.nextStep !== 'string') return null
  }

  return value as unknown as ClientReportSnapshotV1
}

export function parseReportWorkspaceReport(value: unknown): ReportWorkspaceReport | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || value.id.length === 0
    || !isReportStatus(value.status)
    || !isNullableNonNegativeInteger(value.latestVersionNumber)
    || !isNullableNonNegativeInteger(value.publishedVersionNumber)
    || (value.publishedAt !== undefined && !isNullableString(value.publishedAt))
    || (value.firstViewedAt !== undefined && !isNullableString(value.firstViewedAt))
    || (value.lastViewedAt !== undefined && !isNullableString(value.lastViewedAt))
    || (value.viewCount !== undefined && !isNullableNonNegativeInteger(value.viewCount))
    || (value.ctaClickCount !== undefined && !isNullableNonNegativeInteger(value.ctaClickCount))
    || (value.metricsUnavailable !== undefined && typeof value.metricsUnavailable !== 'boolean')
    || (value.signedUrl !== undefined
      && (typeof value.signedUrl !== 'string' || !isSafeReportUrl(value.signedUrl)))) return null
  return value as unknown as ReportWorkspaceReport
}

export function parseReportSaveResponse(value: unknown): ReportSaveResponse | null {
  if (!isRecord(value) || !isRecord(value.reviewArtifact)) return null
  const report = parseReportWorkspaceReport(value.report)
  const snapshot = parseClientReportSnapshot(value.reviewArtifact.snapshot)
  if (!report
    || !snapshot
    || typeof value.reviewArtifact.versionId !== 'string'
    || value.reviewArtifact.versionId.length === 0
    || typeof value.reviewArtifact.versionNumber !== 'number'
    || !Number.isInteger(value.reviewArtifact.versionNumber)
    || value.reviewArtifact.versionNumber <= 0
    || report.latestVersionNumber !== value.reviewArtifact.versionNumber) return null
  return {
    report,
    reviewArtifact: {
      versionId: value.reviewArtifact.versionId,
      versionNumber: value.reviewArtifact.versionNumber,
      snapshot,
    },
  }
}

export function parseReportLifecycleResponse(
  value: unknown,
  requireSignedUrl: boolean,
): LifecycleResponse | null {
  if (!isRecord(value)) return null
  const report = parseReportWorkspaceReport(value.report)
  const signedUrl = typeof value.signedUrl === 'string' && isSafeReportUrl(value.signedUrl)
    ? value.signedUrl
    : undefined
  if (!report || (requireSignedUrl && !signedUrl)) return null
  return signedUrl ? { report, signedUrl } : { report }
}

export function parseAiSummaryResponse(value: unknown): { summary: string } | null {
  if (!isRecord(value)
    || typeof value.summary !== 'string'
    || value.summary.trim().length < 40
    || value.summary.trim().length > 1200) return null
  return { summary: value.summary }
}

export function parseBrandingResponse(value: unknown): { branding: ReportBrandingInput } | null {
  if (!isRecord(value) || !isRecord(value.branding)) return null
  const branding = value.branding
  if (typeof branding.agencyName !== 'string'
    || branding.agencyName.trim().length === 0
    || branding.agencyName.length > 120
    || !isNullableString(branding.logoUrl)
    || (typeof branding.logoUrl === 'string'
      && !isSafeAbsoluteUrl(branding.logoUrl, ['https:']))
    || typeof branding.primaryColor !== 'string'
    || !/^#[0-9A-Fa-f]{6}$/.test(branding.primaryColor)
    || !isNullableString(branding.contactLabel)
    || !isNullableString(branding.contactUrl)
    || ((branding.contactLabel === null) !== (branding.contactUrl === null))
    || (typeof branding.contactUrl === 'string'
      && !isSafeAbsoluteUrl(branding.contactUrl, ['https:', 'mailto:']))) return null
  return { branding: branding as unknown as ReportBrandingInput }
}

export function dashboardReportAssetUrls(reportId: string, versionId: string) {
  const base = `/api/client-reports/${encodeURIComponent(reportId)}/versions/${encodeURIComponent(versionId)}`
  return {
    logoProxyUrl: `${base}/logo`,
    contactProxyUrl: `${base}/contact`,
  }
}
