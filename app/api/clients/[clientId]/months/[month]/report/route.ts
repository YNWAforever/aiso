import { loadMonthlyReport } from '@/lib/monthly-report/store'
import { draftMonthlyReport } from '@/lib/monthly-report/service'
import { monthlyReportAccess, NO_STORE as headers } from '@/lib/monthly-report/gate'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ clientId: string; month: string }> }
const gate = (ctx: Params) => monthlyReportAccess(ctx.params)

export async function GET(_req: Request, ctx: Params) {
  const access = await gate(ctx)
  if (!access.ok) return access.response
  try {
    const report = await loadMonthlyReport(access.accountId, access.clientId, access.period.month)
    return Response.json({ report }, { headers })
  } catch {
    return Response.json({ error: 'MONTHLY_REPORT_UNAVAILABLE' }, { status: 503, headers })
  }
}

/** Saves a draft: `{ locale: 'en' | 'zh-HK', narrative?: string }`. Unknown keys are refused. */
export async function POST(req: Request, ctx: Params) {
  const access = await gate(ctx)
  if (!access.ok) return access.response
  let body: unknown
  try { body = await req.json() } catch { return Response.json({ error: 'INVALID_BODY' }, { status: 400, headers }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'INVALID_BODY' }, { status: 400, headers })
  const b = body as Record<string, unknown>
  if (Object.keys(b).some(k => k !== 'locale' && k !== 'narrative') || (b.locale !== 'en' && b.locale !== 'zh-HK')
    || (b.narrative !== undefined && b.narrative !== null && typeof b.narrative !== 'string')) {
    return Response.json({ error: 'INVALID_BODY' }, { status: 400, headers })
  }
  try {
    const result = await draftMonthlyReport({ accountId: access.accountId, clientId: access.clientId, actorId: access.actorId,
      period: access.period, locale: b.locale, narrative: b.narrative as string | null | undefined, now: access.now })
    if (result.state === 'not_found') return Response.json({ error: 'Not found' }, { status: 404, headers })
    if (result.state === 'branding_required') return Response.json({ error: 'BRANDING_REQUIRED' }, { status: 409, headers })
    if (result.state === 'invalid_narrative') return Response.json({ error: 'INVALID_NARRATIVE' }, { status: 400, headers })
    return Response.json({ reportId: result.reportId, versionNumber: result.versionNumber }, { status: 201, headers })
  } catch {
    // A 2xx must mean the write happened.
    return Response.json({ error: 'MONTHLY_REPORT_UNAVAILABLE' }, { status: 503, headers })
  }
}
