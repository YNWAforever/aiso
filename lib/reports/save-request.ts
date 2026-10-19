import { parseReportSaveResponse, type ReportSaveResponse } from './client-dto'

export interface ReportSaveInput {
  reportId: string | null
  scanId: string
  locale: 'en' | 'zh-HK'
  executiveSummary: string
  expectedLatestVersionId?: string
}
export interface PendingReportSave {
  requestId: string
  request: ReportSaveInput
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isSafeSerializedVersionId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128
  && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value)

// Match replaceExecutiveSummary()'s existing plain-text normalization.
export function normalizeReportSaveSummary(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
export function parseReportSaveInput(value: unknown): ReportSaveInput | null {
  const expectedLatestVersionId = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).expectedLatestVersionId : undefined
  if (!record(value)
    || !(value.reportId === null || (typeof value.reportId === 'string' && value.reportId.length > 0))
    || typeof value.scanId !== 'string' || !value.scanId
    || (value.locale !== 'en' && value.locale !== 'zh-HK')
    || typeof value.executiveSummary !== 'string'
    || value.executiveSummary.trim().length < 40 || value.executiveSummary.trim().length > 1200
    || /[\u0000-\u001f\u007f-\u009f]/.test(value.executiveSummary)
    || (expectedLatestVersionId !== undefined && !isSafeSerializedVersionId(expectedLatestVersionId))
    || (value.reportId === null && expectedLatestVersionId !== undefined)) return null
  const executiveSummary = normalizeReportSaveSummary(value.executiveSummary)
  if (executiveSummary.length < 40) return null
  return {
    reportId: value.reportId, scanId: value.scanId, locale: value.locale,
    executiveSummary,
    ...(expectedLatestVersionId === undefined ? {} : { expectedLatestVersionId }),
  }
}
export function sameReportSaveInput(a: ReportSaveInput, b: ReportSaveInput): boolean {
  return a.reportId === b.reportId && a.scanId === b.scanId && a.locale === b.locale
    && normalizeReportSaveSummary(a.executiveSummary) === normalizeReportSaveSummary(b.executiveSummary)
    && a.expectedLatestVersionId === b.expectedLatestVersionId
}
export function parsePendingReportSave(value: unknown): PendingReportSave | null {
  if (!record(value) || typeof value.requestId !== 'string' || !uuid.test(value.requestId)) return null
  const request = parseReportSaveInput(value.request)
  return request ? { requestId: value.requestId, request } : null
}
export function parseReportSaveReadback(
  value: unknown,
  expected: PendingReportSave,
): { result: ReportSaveResponse | null } | null {
  if (!record(value) || !Object.hasOwn(value, 'receipt')) return null
  if (value.receipt === null) return { result: null }
  const receipt = parsePendingReportSave(value.receipt)
  if (!receipt || receipt.requestId !== expected.requestId
    || !sameReportSaveInput(receipt.request, expected.request) || !record(value.receipt)) return null
  const result = parseReportSaveResponse(value.receipt.result)
  if (!result || result.reviewArtifact.snapshot.locale !== expected.request.locale
    || result.reviewArtifact.snapshot.executiveSummary !== normalizeReportSaveSummary(expected.request.executiveSummary)
    || (expected.request.reportId !== null && result.report.id !== expected.request.reportId)) return null
  return { result }
}

// Optional headers preserve the legacy POST contract. They never carry tenant
// authority; the service derives account/actor from the authenticated session.
export function reportSaveHeaders(req: Request): {
  requestId?: string
  scanId?: string
  expectedLatestVersionId?: string
} {
  const requestId = req.headers.get('X-Report-Request-Id')
  const scanId = req.headers.get('X-Report-Scan-Id')
  const expectedLatestVersionId = req.headers.get('X-Report-Expected-Version-Id')
  if (requestId === null && scanId === null) {
    if (expectedLatestVersionId === null) return {}
    throw new Error('Invalid report save identity')
  }
  if (!requestId || !uuid.test(requestId) || !scanId || !uuid.test(scanId)) {
    throw new Error('Invalid report save identity')
  }
  if (expectedLatestVersionId !== null && !uuid.test(expectedLatestVersionId)) {
    throw new Error('Invalid report save identity')
  }
  return { requestId, scanId, ...(expectedLatestVersionId === null ? {} : { expectedLatestVersionId }) }
}
