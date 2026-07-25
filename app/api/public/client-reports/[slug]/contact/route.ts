import { normalizeReportContact } from '@/lib/reports/branding'
import {
  neutralPublicReportNotFound,
  publicReportHeaders,
  resolvePublishedClientReport,
} from '@/lib/reports/public'
import { incrementClientReportCtaClick } from '@/lib/reports/store'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const query = new URL(request.url).searchParams
  const version = query.get('v')
  const resolved = await resolvePublishedClientReport({
    slug,
    version,
    signature: query.get('s'),
  })
  if (!resolved?.dto.report.branding.contactLabel || !resolved.assets.contactUrl) {
    return neutralPublicReportNotFound()
  }

  let destination: string
  try {
    const contact = normalizeReportContact(
      resolved.dto.report.branding.contactLabel,
      resolved.assets.contactUrl,
    )
    if (!contact.contactUrl) return neutralPublicReportNotFound()
    destination = contact.contactUrl
  } catch {
    return neutralPublicReportNotFound()
  }

  try {
    await incrementClientReportCtaClick({
      publicSlug: slug,
      shareVersion: Number(version),
    })
  } catch {
    // Aggregate engagement is best-effort and must never block a valid redirect.
  }

  return new Response(null, {
    status: 303,
    headers: publicReportHeaders({ Location: destination }),
  })
}
