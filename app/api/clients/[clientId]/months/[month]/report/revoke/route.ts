import { monthlyReportAccess, NO_STORE as headers } from '@/lib/monthly-report/gate'
import { revokeMonthly } from '@/lib/monthly-report/service'

export const dynamic = 'force-dynamic'

/** Retainer OS Slice C2: stop sharing the monthly report. The old link stops working (027 rotates the slug). */
export async function POST(_req: Request, ctx: { params: Promise<{ clientId: string; month: string }> }) {
  const access = await monthlyReportAccess(ctx.params)
  if (!access.ok) return access.response
  try {
    const result = await revokeMonthly({ accountId: access.accountId, clientId: access.clientId, period: access.period })
    if (result.state === 'not_found') return Response.json({ error: 'Not found' }, { status: 404, headers })
    return Response.json({ revoked: true }, { headers })
  } catch {
    return Response.json({ error: 'MONTHLY_REPORT_UNAVAILABLE' }, { status: 503, headers })
  }
}
