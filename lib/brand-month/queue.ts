import 'server-only'
import { db } from '@/lib/db'
import { SITE_EDIT_CAP_TIME_ZONE } from '@/lib/site-edit/handoff'
import { NEAR_CAP_SENDS, PULSE_OVERDUE_DAYS, SEARCH_CONSOLE_STALE_DAYS, type QueueRow } from './queue-rules'
export { needsAttention, type QueueRow } from './queue-rules'
import { CLOSE_GRACE_DAYS, hongKongMonthKey, periodOf, shiftMonth } from './period'
import type { CommercialAccount } from '@/lib/tier'

/**
 * Retainer OS Slice B: the cross-brand queue for one account, one row per brand.
 * Every count is read from the rows that record it; nothing is stored.
 * - approvals waiting: a work item's latest version with no decision yet;
 * - edits sent, not verified: a site-edit job with a `sent` event, no refused
 *   receipt, and no standing `verified_live` attestation;
 * - month sends: the S8 cap's own rule (sent/unknown, or a still-open claim, this Hong Kong month);
 * - Pulse overdue: active questions but no rollup for a recent week;
 * - Search Console stale: bound, but no metric row synced under the current binding recently;
 * - snapshots pending: this month's opening, or last month's closing once due, not recorded.
 */
export async function readMonthQueue(accountId: string, now: Date = new Date()): Promise<QueueRow[]> {
  const sql = db()
  const current = periodOf(hongKongMonthKey(now))!, previous = periodOf(shiftMonth(current.key, -1))!
  const closeDue = now.getTime() >= Date.parse(previous.end) + CLOSE_GRACE_DAYS * 86_400_000
  const rows = await sql`
    select c.id, coalesce(c.brand_name, c.domain, '') as brand_name,
      (select count(*) from (
          select distinct on (v.work_item_id) v.id, v.content_hash from work_item_versions v
          where v.account_id = c.account_id and v.client_id = c.id order by v.work_item_id, v.version_number desc
        ) lv where not exists (select 1 from work_item_decisions r where r.account_id = c.account_id and r.client_id = c.id
          and r.version_id = lv.id and r.content_hash = lv.content_hash))::int as approvals_waiting,
      (select count(*) from site_edit_jobs j where j.account_id = c.account_id and j.client_id = c.id
        and exists (select 1 from site_edit_job_events e where e.job_id = j.id and e.account_id = j.account_id and e.kind = 'sent')
        and not exists (select 1 from site_edit_receipts r where r.job_id = j.id and r.account_id = j.account_id and r.status = 'rejected')
        and not exists (select 1 from work_item_delivery_events d where d.account_id = j.account_id and d.site_edit_job_id = j.id
          and d.kind = 'attest' and not exists (select 1 from work_item_delivery_events w where w.account_id = d.account_id
            and w.target_attestation_id = d.id and w.kind = 'withdraw')))::int as edits_unverified,
      (select count(distinct j2.id) from site_edit_jobs j2
        join site_edit_job_events e2 on e2.job_id = j2.id and e2.account_id = j2.account_id
        where j2.account_id = c.account_id and j2.client_id = c.id
          and e2.created_at >= (date_trunc('month', ${now.toISOString()}::timestamptz at time zone ${SITE_EDIT_CAP_TIME_ZONE}::text) at time zone ${SITE_EDIT_CAP_TIME_ZONE}::text)
          and (e2.kind in ('sent', 'unknown') or (e2.kind = 'claim'
            and e2.seq = (select max(e3.seq) from site_edit_job_events e3 where e3.job_id = j2.id and e3.account_id = j2.account_id))))::int as month_sends,
      (select count(*) from prompt_bank p where p.client_id = c.id and p.is_active)::int as active_questions,
      (select max(s.scan_week) from pulse_weekly_summary s where s.client_id = c.id and s.platform is not null)::text as last_pulse_week,
      b.bound_at is not null as bound,
      (select max(q.synced_at) from search_console_daily q where q.account_id = c.account_id and q.client_id = c.id
        and b.bound_at is not null and q.synced_at >= b.bound_at) as last_sync,
      not exists (select 1 from brand_month_snapshots m where m.account_id = c.account_id and m.client_id = c.id
          and m.month = ${current.month}::date and m.kind = 'opening')
        or (${closeDue}::boolean and not exists (select 1 from brand_month_snapshots m where m.account_id = c.account_id
          and m.client_id = c.id and m.month = ${previous.month}::date and m.kind = 'closing')) as snapshots_pending
    from clients c
    left join search_console_bindings b on b.account_id = c.account_id and b.client_id = c.id
    where c.account_id = ${accountId}::uuid
    order by lower(coalesce(c.brand_name, c.domain, '')), c.id`
  const hkToday = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
  const overdueBefore = new Date(Date.parse(`${hkToday}T00:00:00Z`) - PULSE_OVERDUE_DAYS * 86_400_000).toISOString().slice(0, 10)
  const staleBefore = now.getTime() - SEARCH_CONSOLE_STALE_DAYS * 86_400_000
  return rows.map(r => {
    const lastSync = r.last_sync ? new Date(r.last_sync as string).toISOString() : null
    const lastPulseWeek = r.last_pulse_week ? String(r.last_pulse_week) : null
    const activeQuestions = Number(r.active_questions), monthSends = Number(r.month_sends)
    return {
      clientId: String(r.id), brandName: String(r.brand_name),
      approvalsWaiting: Number(r.approvals_waiting), editsUnverified: Number(r.edits_unverified),
      monthSends, nearCap: monthSends >= NEAR_CAP_SENDS,
      activeQuestions, lastPulseWeek,
      pulseOverdue: activeQuestions > 0 && (!lastPulseWeek || lastPulseWeek < overdueBefore),
      searchConsole: r.bound !== true ? 'not_connected' : lastSync && Date.parse(lastSync) >= staleBefore ? 'ok' : 'stale',
      lastSync, snapshotsPending: r.snapshots_pending === true,
    }
  })
}

export type DueMonthBrand = { accountId: string; clientId: string; account: NonNullable<CommercialAccount> }

/**
 * The scheduled snapshot route's selection: brands of EVERY account missing a
 * due snapshot (this month's opening, or last month's closing once due).
 * Deliberately account-blind, like `loadDueBindings`: the cron has no session.
 * Its only account predicate is the join; the caller checks entitlement per
 * account and writes through `recordDueSnapshots`, which scopes every write.
 */
export async function loadDueMonthBrands(now: Date, limit: number): Promise<DueMonthBrand[]> {
  const sql = db()
  const current = periodOf(hongKongMonthKey(now))!, previous = periodOf(shiftMonth(current.key, -1))!
  const closeDue = now.getTime() >= Date.parse(previous.end) + CLOSE_GRACE_DAYS * 86_400_000
  const rows = await sql`
    select c.id as client_id, c.account_id, a.plan, a.status, a.stripe_subscription_id, a.trial_ends_at, a.override_plan, a.override_expires_at
    from clients c join accounts a on a.id = c.account_id
    where not exists (select 1 from brand_month_snapshots m where m.account_id = c.account_id and m.client_id = c.id
        and m.month = ${current.month}::date and m.kind = 'opening')
      or (${closeDue}::boolean and not exists (select 1 from brand_month_snapshots m where m.account_id = c.account_id
        and m.client_id = c.id and m.month = ${previous.month}::date and m.kind = 'closing'))
    order by c.id limit ${limit}`
  return rows.map(r => ({ accountId: String(r.account_id), clientId: String(r.client_id), account: {
    plan: r.plan, status: r.status, stripe_subscription_id: r.stripe_subscription_id, trial_ends_at: r.trial_ends_at,
    override_plan: r.override_plan, override_expires_at: r.override_expires_at } }))
}
