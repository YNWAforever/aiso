import { parseReportSaveResponse, type ReportSaveResponse } from './client-dto'

export interface ReportSaveInput {
  reportId: string | null
  scanId: string
  locale: 'en' | 'zh-HK'
  executiveSummary: string
}
export interface PendingReportSave {
  requestId: string
  request: ReportSaveInput
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Match replaceExecutiveSummary()'s existing plain-text normalization.
export function normalizeReportSaveSummary(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
export function parseReportSaveInput(value: unknown): ReportSaveInput | null {
  if (!record(value)
    || !(value.reportId === null || (typeof value.reportId === 'string' && value.reportId.length > 0))
    || typeof value.scanId !== 'string' || !value.scanId
    || (value.locale !== 'en' && value.locale !== 'zh-HK')
    || typeof value.executiveSummary !== 'string'
    || value.executiveSummary.trim().length < 40 || value.executiveSummary.trim().length > 1200
    || /[\u0000-\u001f\u007f-\u009f]/.test(value.executiveSummary)) return null
  const executiveSummary = normalizeReportSaveSummary(value.executiveSummary)
  if (executiveSummary.length < 40) return null
  return {
    reportId: value.reportId, scanId: value.scanId, locale: value.locale,
    executiveSummary,
  }
}
export function sameReportSaveInput(a: ReportSaveInput, b: ReportSaveInput): boolean {
  return a.reportId === b.reportId && a.scanId === b.scanId && a.locale === b.locale
    && normalizeReportSaveSummary(a.executiveSummary) === normalizeReportSaveSummary(b.executiveSummary)
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
export function reportSaveHeaders(req: Request): { requestId?: string; scanId?: string } {
  const requestId = req.headers.get('X-Report-Request-Id')
  const scanId = req.headers.get('X-Report-Scan-Id')
  if (requestId === null && scanId === null) return {}
  if (!requestId || !uuid.test(requestId) || !scanId || !uuid.test(scanId)) {
    throw new Error('Invalid report save identity')
  }
  return { requestId, scanId }
}
