import { normalizeReportContact } from '@/lib/reports/branding'
import {
  neutralPublicReportNotFound,
  publicReportHeaders,
} from '@/lib/reports/public'
import { incrementClientReportCtaClick } from '@/lib/reports/store'
import { resolvePublishedMonthlyReportAssets, resolveReviewMonthlyReportAssets } from '@/lib/monthly-report/public'

/** The monthly report's contact CTA: verified link, then a counted redirect to the stored destination. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const query = new URL(request.url).searchParams
  const version = query.get('v')
  const review = query.get('review')
  const assets = review
    ? await resolveReviewMonthlyReportAssets({ slug, review })
    : await resolvePublishedMonthlyReportAssets({ slug, version, signature: query.get('s') })
  if (!assets?.contactUrl) return neutralPublicReportNotFound()

  // The stored destination is re-normalised before redirecting: it was validated
  // on the way in, and this is the one place a public link could become an open
  // redirect if that ever regressed.
  let destination: string
  try {
    const contact = normalizeReportContact(assets.contactLabel, assets.contactUrl)
    if (!contact.contactUrl) return neutralPublicReportNotFound()
    destination = contact.contactUrl
  } catch {
    return neutralPublicReportNotFound()
  }

  try {
    await incrementClientReportCtaClick({ publicSlug: slug, shareVersion: Number(version) })
  } catch {
    // Aggregate engagement is best-effort and must never block a valid redirect.
  }

  return new Response(null, { status: 303, headers: publicReportHeaders({ Location: destination }) })
}
