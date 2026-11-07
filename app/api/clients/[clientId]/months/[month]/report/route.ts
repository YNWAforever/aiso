import { getProfile } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { isViewableMonth, periodOf, type BrandMonthPeriod } from '@/lib/brand-month/period'
import { loadMonthlyReport } from '@/lib/monthly-report/store'
import { draftMonthlyReport } from '@/lib/monthly-report/service'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers = { 'Cache-Control': 'no-store' }
type Params = { params: Promise<{ clientId: string; month: string }> }
type Access = { ok: false; response: Response } | { ok: true; accountId: string; actorId: string; clientId: string; period: BrandMonthPeriod; now: Date }

/** Retainer OS Slice C1: the brand's monthly report draft. Auth → client_reports_online → ownership (404). */
async function gate({ params }: Params): Promise<Access> {
  const profile = await getProfile()
  if (!profile) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401, headers }) }
  if (!resolveCommercialEntitlement(profile.accounts).features.client_reports_online) {
    return { ok: false, response: Response.json({ error: 'UPGRADE_REQUIRED' }, { status: 403, headers }) }
  }
  const { clientId, month } = await params
  const now = new Date(), period = periodOf(month)
  if (!UUID.test(clientId) || !period || !isViewableMonth(month, now)) return { ok: false, response: Response.json({ error: 'Not found' }, { status: 404, headers }) }
  return { ok: true, accountId: profile.account_id, actorId: profile.id, clientId, period, now }
}

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
