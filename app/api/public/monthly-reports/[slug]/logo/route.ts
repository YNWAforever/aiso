import { fetchReportLogo } from '@/lib/reports/branding'
import {
  neutralPublicReportNotFound,
  publicReportHeaders,
} from '@/lib/reports/public'
import { resolvePublishedMonthlyReportAssets, resolveReviewMonthlyReportAssets } from '@/lib/monthly-report/public'

/**
 * The monthly report's agency logo, re-verified through the link's own
 * signature — the share signature, or the review token for an unpublished
 * report a client is reviewing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const query = new URL(request.url).searchParams
  const review = query.get('review')
  const assets = review
    ? await resolveReviewMonthlyReportAssets({ slug, review })
    : await resolvePublishedMonthlyReportAssets({ slug, version: query.get('v'), signature: query.get('s') })
  if (!assets?.logoUrl) return neutralPublicReportNotFound()

  try {
    const logo = await fetchReportLogo(assets.logoUrl)
    return new Response(Uint8Array.from(logo.bytes), {
      headers: publicReportHeaders({
        'Content-Disposition': 'inline',
        'Content-Length': String(logo.bytes.byteLength),
        'Content-Type': logo.contentType,
      }),
    })
  } catch {
    return neutralPublicReportNotFound()
  }
}
