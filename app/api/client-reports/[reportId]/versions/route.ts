import {
  ReportServiceError,
  appendAuthenticatedClientReportVersion,
  reportErrorResponse,
  reportJson,
} from '@/lib/reports/service'
import type { ReportLocale } from '@/lib/reports/types'

function identifier(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ReportServiceError('invalid_request')
  }
  return value
}

async function parseBody(req: Request): Promise<{ locale: ReportLocale; executiveSummary: string }> {
  let value: unknown
  try {
    value = await req.json()
  } catch {
    throw new ReportServiceError('invalid_request')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ReportServiceError('invalid_request')
  const body = value as Record<string, unknown>
  if (Object.keys(body).length !== 2
    || !Object.hasOwn(body, 'locale')
    || !Object.hasOwn(body, 'executiveSummary')
    || (body.locale !== 'en' && body.locale !== 'zh-HK')
    || typeof body.executiveSummary !== 'string'
    || body.executiveSummary.trim().length < 40
    || body.executiveSummary.trim().length > 1200
    || /[\u0000-\u001f\u007f-\u009f]/.test(body.executiveSummary)) {
    throw new ReportServiceError('invalid_request')
  }
  return { locale: body.locale, executiveSummary: body.executiveSummary }
}

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/client-reports/[reportId]/versions'>,
) {
  try {
    const { reportId } = await ctx.params
    const body = await parseBody(req)
    return reportJson(await appendAuthenticatedClientReportVersion({
      reportId: identifier(reportId),
      ...body,
    }), 201)
  } catch (error) {
    return reportErrorResponse(error)
  }
}