import {
  ReportServiceError,
  publishAuthenticatedClientReport,
  reportErrorResponse,
  reportJson,
} from '@/lib/reports/service'

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UUID.test(value)) {
    throw new ReportServiceError('invalid_request')
  }
  return value
}

async function reviewedVersionId(req: Request) {
  let value: unknown
  try {
    value = await req.json()
  } catch {
    throw new ReportServiceError('invalid_request')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== 1
    || !Object.hasOwn(value, 'reviewedVersionId')) {
    throw new ReportServiceError('invalid_request')
  }
  return identifier((value as { reviewedVersionId?: unknown }).reviewedVersionId)
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ reportId: string }> },
) {
  try {
    const { reportId } = await ctx.params
    const versionId = await reviewedVersionId(req)
    return reportJson(await publishAuthenticatedClientReport(identifier(reportId), versionId))
  } catch (error) {
    return reportErrorResponse(error)
  }
}
