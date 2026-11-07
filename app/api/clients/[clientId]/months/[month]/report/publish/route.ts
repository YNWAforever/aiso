import { monthlyReportAccess, NO_STORE as headers } from '@/lib/monthly-report/gate'
import { publishMonthly } from '@/lib/monthly-report/service'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Retainer OS Slice C2: publish the reviewed monthly report draft. Body: `{ versionId }`. */
export async function POST(req: Request, ctx: { params: Promise<{ clientId: string; month: string }> }) {
  const access = await monthlyReportAccess(ctx.params)
  if (!access.ok) return access.response
  let body: unknown
  try { body = await req.json() } catch { return Response.json({ error: 'INVALID_BODY' }, { status: 400, headers }) }
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => k !== 'versionId') || typeof b.versionId !== 'string' || !UUID.test(b.versionId)) {
    return Response.json({ error: 'INVALID_BODY' }, { status: 400, headers })
  }
  try {
    const result = await publishMonthly({ accountId: access.accountId, clientId: access.clientId, period: access.period, reviewedVersionId: b.versionId })
    if (result.state === 'not_found') return Response.json({ error: 'Not found' }, { status: 404, headers })
    if (result.state === 'stale') return Response.json({ error: 'STALE_VERSION' }, { status: 409, headers })
    return Response.json({ shareUrl: result.shareUrl, versionNumber: result.versionNumber }, { headers })
  } catch {
    return Response.json({ error: 'MONTHLY_REPORT_UNAVAILABLE' }, { status: 503, headers })
  }
}
