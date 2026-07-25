import { fetchReportLogo } from '@/lib/reports/branding'
import {
  ReportServiceError,
  loadAuthenticatedClientReportPreviewVersion,
  reportErrorResponse,
} from '@/lib/reports/service'

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UUID.test(value)) {
    throw new ReportServiceError('invalid_request')
  }
  return value
}

export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/client-reports/[reportId]/versions/[versionId]/logo'>,
) {
  try {
    const { reportId, versionId } = await ctx.params
    const { snapshot } = await loadAuthenticatedClientReportPreviewVersion(
      identifier(reportId),
      identifier(versionId),
    )
    if (!snapshot.branding.logoUrl) throw new ReportServiceError('not_found')

    const logo = await fetchReportLogo(snapshot.branding.logoUrl)
    return new Response(Uint8Array.from(logo.bytes), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Length': String(logo.bytes.byteLength),
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Type': logo.contentType,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return reportErrorResponse(error)
  }
}
