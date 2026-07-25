import {
  ReportServiceError,
  reportErrorResponse,
  reportJson,
  rotateAuthenticatedClientReportLink,
} from '@/lib/reports/service'

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UUID.test(value)) {
    throw new ReportServiceError('invalid_request')
  }
  return value
}

async function requireEmptyBody(req: Request) {
  let value: unknown
  try {
    value = await req.json()
  } catch {
    throw new ReportServiceError('invalid_request')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw new ReportServiceError('invalid_request')
  }
}

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/client-reports/[reportId]/rotate-link'>,
) {
  try {
    const { reportId } = await ctx.params
    await requireEmptyBody(req)
    return reportJson(await rotateAuthenticatedClientReportLink(identifier(reportId)))
  } catch (error) {
    return reportErrorResponse(error)
  }
}