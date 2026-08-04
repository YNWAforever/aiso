import { normalizeReportContact } from '@/lib/reports/branding'
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
  ctx: { params: Promise<{ reportId: string; versionId: string }> },
) {
  try {
    const { reportId, versionId } = await ctx.params
    const { snapshot } = await loadAuthenticatedClientReportPreviewVersion(
      identifier(reportId),
      identifier(versionId),
    )
    let contact: ReturnType<typeof normalizeReportContact>
    try {
      contact = normalizeReportContact(
        snapshot.branding.contactLabel,
        snapshot.branding.contactUrl,
      )
    } catch {
      throw new ReportServiceError('conflict')
    }
    if (!contact.contactUrl) throw new ReportServiceError('not_found')

    return new Response(null, {
      status: 303,
      headers: {
        'Cache-Control': 'no-store',
        Location: contact.contactUrl,
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return reportErrorResponse(error)
  }
}
