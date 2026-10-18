import { readAuthenticatedReportSaveReceipt, reportJson, reportErrorResponse, ReportServiceError } from '@/lib/reports/service'

export async function GET(_req: Request, ctx: { params: Promise<{ clientId: string; requestId: string }> }) {
  try {
    const { clientId, requestId } = await ctx.params
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    if (!uuid.test(clientId) || !uuid.test(requestId)) throw new ReportServiceError('invalid_request')
    return reportJson(await readAuthenticatedReportSaveReceipt(clientId, requestId))
  } catch (error) { return reportErrorResponse(error) }
}
