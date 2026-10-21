import 'server-only'
import { db } from '@/lib/db'
import {
  ReportStoreError, validateCreateClientReportResult, validateAppendClientReportResult,
  type ReportVersionWriteInput,
} from './store'
import { normalizeReportSaveSummary, type ReportSaveInput } from './save-request'

export function storedReportSaveMutation(
  value: unknown,
  scope: { accountId: string; clientId: string },
  reportId: string | null,
) {
  const expected = { accountId: scope.accountId, clientId: scope.clientId }
  return reportId === null ? validateCreateClientReportResult(value, expected)
    : validateAppendClientReportResult(value, { ...expected, reportId })
}
function failure(error: unknown): never {
  const message = error instanceof Error ? error.message : ''
  throw new ReportStoreError({
    message: message.includes('CLIENT_REPORT_SAVE_CONFLICT')
      ? 'CLIENT_REPORT_SAVE_CONFLICT' : 'CLIENT_REPORT_SAVE_UNAVAILABLE',
  })
}
export async function loadReportSaveReceipt(input: {
  accountId: string; clientId: string; actorId: string; requestId: string
}): Promise<{ request_payload: unknown; result: unknown } | null> {
  const sql = db()
  try {
    const rows = await sql`
      select request_payload, result from public.report_save_receipts
      where account_id=${input.accountId}::uuid and client_id=${input.clientId}::uuid
        and actor_id=${input.actorId}::uuid and request_id=${input.requestId}::uuid
    `
    return rows[0] as { request_payload: unknown; result: unknown } | undefined ?? null
  } catch (error) { return failure(error) }
}
export async function saveClientReportRequest(
  input: ReportVersionWriteInput & {
    requestId: string
    reportId: string | null
    expectedLatestVersionId?: string
  },
) {
  const sql = db()
  try {
    if (input.expectedLatestVersionId !== undefined) {
      if (!input.reportId) throw new Error('CLIENT_REPORT_SAVE_INVALID')
      const rows = await sql`
        select public.save_client_report_draft_request_with_version(
          p_request_id=>${input.requestId}::uuid, p_report_id=>${input.reportId}::uuid,
          p_account_id=>${input.accountId}::uuid, p_client_id=>${input.clientId}::uuid,
          p_source_scan_id=>${input.sourceScanId}::uuid, p_previous_scan_id=>${input.previousScanId}::uuid,
          p_locale=>${input.locale}, p_executive_summary=>${input.executiveSummary},
          p_snapshot_schema_version=>${input.snapshotSchemaVersion}::int,
          p_snapshot=>${JSON.stringify(input.snapshot)}::jsonb, p_created_by=>${input.createdBy}::uuid,
          p_expected_latest_version_id=>${input.expectedLatestVersionId}::uuid
        ) as result
      `
      return storedReportSaveMutation(rows[0]?.result, input, input.reportId)
    }
    const rows = await sql`
      select public.save_client_report_draft_request(
        p_request_id=>${input.requestId}::uuid, p_report_id=>${input.reportId}::uuid,
        p_account_id=>${input.accountId}::uuid, p_client_id=>${input.clientId}::uuid,
        p_source_scan_id=>${input.sourceScanId}::uuid, p_previous_scan_id=>${input.previousScanId}::uuid,
        p_locale=>${input.locale}, p_executive_summary=>${input.executiveSummary},
        p_snapshot_schema_version=>${input.snapshotSchemaVersion}::int,
        p_snapshot=>${JSON.stringify(input.snapshot)}::jsonb, p_created_by=>${input.createdBy}::uuid
      ) as result
    `
    return storedReportSaveMutation(rows[0]?.result, input, input.reportId)
  } catch (error) { return failure(error) }
}
export function reportSaveInput(input: {
  reportId: string | null; scanId: string; locale: 'en' | 'zh-HK'; executiveSummary: string
}): ReportSaveInput {
  return { ...input, executiveSummary: normalizeReportSaveSummary(input.executiveSummary) }
}
