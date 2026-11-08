import { loadMonthlyReport } from '@/lib/monthly-report/store'
import { draftMonthlyNarrative, monthlyNarrativeFacts } from '@/lib/monthly-report/narrative'
import { monthlyReportAccess, NO_STORE as headers } from '@/lib/monthly-report/gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Params = { params: Promise<{ clientId: string; month: string }> }

/**
 * Drafts the monthly narrative from the stored record only. Returns wording for
 * the operator to review: this route writes nothing, and the save path is the
 * editor's existing POST, which is what freezes a version.
 */
export async function POST(req: Request, ctx: Params) {
  const access = await monthlyReportAccess(ctx.params)
  if (!access.ok) return access.response

  let body: unknown
  try { body = await req.json() } catch { return Response.json({ error: 'INVALID_BODY' }, { status: 400, headers }) }
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 1 || (b.locale !== 'en' && b.locale !== 'zh-HK')) {
    return Response.json({ error: 'INVALID_BODY' }, { status: 400, headers })
  }

  try {
    const report = await loadMonthlyReport(access.accountId, access.clientId, access.period.month)
    // The facts come from a stored version, so a draft must exist: AI wording is
    // never the thing that creates the month's first narrative.
    if (!report) return Response.json({ error: 'DRAFT_REQUIRED' }, { status: 409, headers })
    const result = await draftMonthlyNarrative(monthlyNarrativeFacts(report.snapshot, b.locale))
    return Response.json(result, { headers })
  } catch {
    return Response.json({ error: 'MONTHLY_REPORT_UNAVAILABLE' }, { status: 503, headers })
  }
}
