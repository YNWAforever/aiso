import { fetchReportLogo } from '@/lib/reports/branding'
import {
  neutralPublicReportNotFound,
  publicReportHeaders,
} from '@/lib/reports/public'
import { resolvePublishedMonthlyReportAssets } from '@/lib/monthly-report/public'

/** The monthly report's agency logo, re-verified through the link's own signature. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const query = new URL(request.url).searchParams
  const assets = await resolvePublishedMonthlyReportAssets({ slug, version: query.get('v'), signature: query.get('s') })
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
