import { getProfile } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { dueSnapshots, isViewableMonth, periodOf, type BrandMonthPeriod } from '@/lib/brand-month/period'
import { readBrandMonth, recordDueSnapshots } from '@/lib/brand-month/store'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers = { 'Cache-Control': 'no-store' }
type Params = { params: Promise<{ clientId: string; month: string }> }

/**
 * Retainer OS Slice B: one brand's Hong Kong month. Auth → entitlement →
 * ownership (inside the store's queries, so a foreign brand is 404). The month
 * record feeds the monthly client report, so it rides the same entitlement.
 */
async function gate({ params }: Params): Promise<{ ok: false; response: Response } | { ok: true; accountId: string; clientId: string; period: BrandMonthPeriod; now: Date }> {
  const profile = await getProfile()
  if (!profile) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401, headers }) }
  if (!resolveCommercialEntitlement(profile.accounts).features.client_reports_online) {
    return { ok: false, response: Response.json({ error: 'UPGRADE_REQUIRED' }, { status: 403, headers }) }
  }
  const { clientId, month } = await params
  const now = new Date(), period = periodOf(month)
  if (!UUID.test(clientId) || !period || !isViewableMonth(month, now)) {
    return { ok: false, response: Response.json({ error: 'Not found' }, { status: 404, headers }) }
  }
  return { ok: true, accountId: profile.account_id, clientId, period, now }
}

/** The month view. Reads only: a snapshot that is due but not recorded shows as pending. */
export async function GET(_req: Request, ctx: Params) {
  const access = await gate(ctx)
  if (!access.ok) return access.response
  try {
    const month = await readBrandMonth(access.accountId, access.clientId, access.period)
    if (month.state === 'not_found') return Response.json({ error: 'Not found' }, { status: 404, headers })
    const recorded = new Set(month.snapshots.map(s => s.kind))
    return Response.json({ period: access.period, brandName: month.brandName, snapshots: month.snapshots,
      pending: dueSnapshots(access.period, access.now).filter(k => !recorded.has(k)), activity: month.activity }, { headers })
  } catch {
    return Response.json({ error: 'MONTH_UNAVAILABLE' }, { status: 503, headers })
  }
}

/** Records the snapshots that are due and missing. Safe to repeat; nothing recorded is ever rewritten. */
export async function POST(_req: Request, ctx: Params) {
  const access = await gate(ctx)
  if (!access.ok) return access.response
  try {
    const result = await recordDueSnapshots(access.accountId, access.clientId, access.period, access.now)
    if (result.state === 'not_found') return Response.json({ error: 'Not found' }, { status: 404, headers })
    return Response.json({ recorded: result.recorded }, { status: result.recorded.length ? 201 : 200, headers })
  } catch {
    // A 2xx must mean the write happened.
    return Response.json({ error: 'MONTH_UNAVAILABLE' }, { status: 503, headers })
  }
}
