import { fetchReportLogo } from '@/lib/reports/branding'
import {
  neutralPublicReportNotFound,
  publicReportHeaders,
  resolvePublishedClientReport,
} from '@/lib/reports/public'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const query = new URL(request.url).searchParams
  const resolved = await resolvePublishedClientReport({
    slug,
    version: query.get('v'),
    signature: query.get('s'),
  })
  if (!resolved?.assets.logoUrl) return neutralPublicReportNotFound()

  try {
    const logo = await fetchReportLogo(resolved.assets.logoUrl)
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
