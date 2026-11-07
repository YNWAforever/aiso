import 'server-only'
import { getProfile } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { hongKongMonthKey, isViewableMonth, periodOf, type BrandMonthPeriod } from '@/lib/brand-month/period'

export const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type MonthlyReportAccess =
  | { ok: false; response: Response }
  | { ok: true; accountId: string; actorId: string; clientId: string; period: BrandMonthPeriod; now: Date }

/**
 * The monthly report routes' one gate: auth → client_reports_online → a
 * well-formed id and month. Ownership is in the store. Drafting and publishing
 * are held to the month view's lookback; `anyPastMonth` (stopping sharing)
 * accepts any month that has started, because a published link has no age
 * limit and its owner must always be able to withdraw it.
 */
export async function monthlyReportAccess(params: Promise<{ clientId: string; month: string }>, options: { anyPastMonth?: boolean } = {}): Promise<MonthlyReportAccess> {
  const profile = await getProfile()
  if (!profile) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE }) }
  if (!resolveCommercialEntitlement(profile.accounts).features.client_reports_online) {
    return { ok: false, response: Response.json({ error: 'UPGRADE_REQUIRED' }, { status: 403, headers: NO_STORE }) }
  }
  const { clientId, month } = await params
  const now = new Date(), period = periodOf(month)
  const allowed = options.anyPastMonth ? month <= hongKongMonthKey(now) : isViewableMonth(month, now)
  if (!UUID.test(clientId) || !period || !allowed) {
    return { ok: false, response: Response.json({ error: 'Not found' }, { status: 404, headers: NO_STORE }) }
  }
  return { ok: true, accountId: profile.account_id, actorId: profile.id, clientId, period, now }
}
