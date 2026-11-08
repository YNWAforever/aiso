import 'server-only'
import { db } from '@/lib/db'
import { loadBinding } from '@/lib/integrations/search-console/store'
import { bindingMatchesDomain } from '@/lib/integrations/search-console/binding'
import { asOfFor, dueSnapshots, type BrandMonthPeriod, type SnapshotKind } from './period'

/** Days of Search Console data each snapshot sums, ending the day before its boundary. */
export const SNAPSHOT_SEARCH_DAYS = 28
/** Delivered changes listed per kind in a month view. */
export const MONTH_DELIVERY_LIST_LIMIT = 50

export type SnapshotFigures = {
  version: 1
  scan: { state: 'ok'; scanId: string; score: number | null; recordedAt: string } | { state: 'none' }
  pulse: { state: 'ok'; week: string; platforms: { platform: string; sovScore: number | null; totalQueries: number | null; brandMentions: number | null }[] } | { state: 'none' }
  search: { state: 'ok'; from: string; through: string; days: number; clicks: number; impressions: number } | { state: 'none'; from: string; through: string } | { state: 'not_connected' }
}

export type MonthSnapshot = { kind: SnapshotKind; asOf: string; takenAt: string; figures: SnapshotFigures }
export type MonthDelivery = { attestationId: string; workItemId: string; title: string; versionId: string; recordedAt: string; siteEditJobId: string | null }
export type MonthActivity = {
  workItemsOpened: number
  workItemsDone: number
  siteEditsSent: number
  receiptsCompleted: number
  receiptsRejected: number
  verifiedLive: MonthDelivery[]
  selfReported: MonthDelivery[]
}

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value)
const num = (value: unknown) => value === null || value === undefined ? null : Number(value)
/** The Hong Kong calendar date of a boundary instant (always a midnight there). */
const hkDate = (instant: string) => new Date(Date.parse(instant) + 8 * 3_600_000).toISOString().slice(0, 10)
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/**
 * The opening/closing figures for one brand as of a boundary instant: only rows
 * dated before it. Search Console follows the rule every reader follows
 * (`synced_at >= bound_at` under the current binding, which must still cover the
 * domain); without one the state is `not_connected`, never zero.
 */
export async function computeFigures(accountId: string, clientId: string, asOf: string): Promise<SnapshotFigures> {
  const sql = db()
  const boundaryDate = hkDate(asOf), from = addDays(boundaryDate, -SNAPSHOT_SEARCH_DAYS), through = addDays(boundaryDate, -1)
  const binding = await loadBinding(accountId, clientId)
  const boundAt = binding && bindingMatchesDomain(binding, binding.currentDomain) ? binding.boundAt : null
  const [scans, pulse, search] = await Promise.all([
    sql`select id, score, created_at from scans
      where account_id = ${accountId}::uuid and client_id = ${clientId}::uuid and created_at < ${asOf}::timestamptz
      order by created_at desc, id desc limit 1`,
    // The latest week that had fully ended by the boundary; the newest row per platform (031's rule).
    sql`with latest as (
        select max(s.scan_week) as week from pulse_weekly_summary s join clients c on c.id = s.client_id
        where c.id = ${clientId}::uuid and c.account_id = ${accountId}::uuid and s.platform is not null
          and s.scan_week + 7 <= ${boundaryDate}::date
      )
      select distinct on (s.platform) s.platform, s.sov_score, s.total_queries, s.brand_mentions, l.week::text as week
      from pulse_weekly_summary s join clients c on c.id = s.client_id join latest l on s.scan_week = l.week
      where c.id = ${clientId}::uuid and c.account_id = ${accountId}::uuid and s.platform is not null
      order by s.platform, s.created_at desc nulls last, s.id desc`,
    boundAt ? sql`select coalesce(sum(clicks), 0)::float8 as clicks, coalesce(sum(impressions), 0)::float8 as impressions, count(*)::int as days
      from search_console_daily q
      where q.account_id = ${accountId}::uuid and q.client_id = ${clientId}::uuid and q.scope = 'property'
        and q.date >= ${from}::date and q.date <= ${through}::date and q.synced_at >= ${boundAt}::timestamptz
        and exists (select 1 from search_console_bindings b where b.account_id = q.account_id and b.client_id = q.client_id
          and b.bound_at = ${boundAt}::timestamptz)` : Promise.resolve(null),
  ])
  const scan = scans[0]
  const days = search ? Number(search[0]?.days ?? 0) : 0
  return {
    version: 1,
    scan: scan ? { state: 'ok', scanId: String(scan.id), score: num(scan.score), recordedAt: iso(scan.created_at) } : { state: 'none' },
    pulse: pulse.length ? { state: 'ok', week: String(pulse[0].week), platforms: pulse.map(p => ({ platform: String(p.platform),
      sovScore: num(p.sov_score), totalQueries: num(p.total_queries), brandMentions: num(p.brand_mentions) })) } : { state: 'none' },
    search: !search ? { state: 'not_connected' } : days > 0
      ? { state: 'ok', from, through, days, clicks: Number(search[0].clicks), impressions: Number(search[0].impressions) }
      : { state: 'none', from, through },
  }
}

/** What happened in the month, derived from the rows that record it. Nothing here is copied or stored. */
export async function readActivity(accountId: string, clientId: string, period: BrandMonthPeriod): Promise<MonthActivity> {
  const sql = db(), start = period.start, end = period.end
  const [counts, deliveries] = await Promise.all([
    sql`select
        (select count(*) from evidence_work_items w where w.account_id = ${accountId}::uuid and w.client_id = ${clientId}::uuid
          and w.created_at >= ${start}::timestamptz and w.created_at < ${end}::timestamptz)::int as opened,
        (select count(distinct v.work_item_id) from visibility_completion_events v where v.account_id = ${accountId}::uuid
          and v.client_id = ${clientId}::uuid and v.completed_at >= ${start}::timestamptz and v.completed_at < ${end}::timestamptz)::int as done,
        (select count(distinct e.job_id) from site_edit_job_events e join site_edit_jobs j on j.id = e.job_id and j.account_id = e.account_id
          where e.account_id = ${accountId}::uuid and j.client_id = ${clientId}::uuid and e.kind = 'sent'
            and e.created_at >= ${start}::timestamptz and e.created_at < ${end}::timestamptz)::int as sent,
        (select count(*) filter (where r.status = 'completed') from site_edit_receipts r join site_edit_jobs j on j.id = r.job_id and j.account_id = r.account_id
          where r.account_id = ${accountId}::uuid and j.client_id = ${clientId}::uuid
            and r.received_at >= ${start}::timestamptz and r.received_at < ${end}::timestamptz)::int as completed,
        (select count(*) filter (where r.status = 'rejected') from site_edit_receipts r join site_edit_jobs j on j.id = r.job_id and j.account_id = r.account_id
          where r.account_id = ${accountId}::uuid and j.client_id = ${clientId}::uuid
            and r.received_at >= ${start}::timestamptz and r.received_at < ${end}::timestamptz)::int as rejected`,
    // C9e attestations recorded this month and not withdrawn since. Only `verified_live` ones may be called verified.
    sql`select * from (
        select d.id, d.work_item_id, d.version_id, d.recorded_at, d.site_edit_job_id, d.provenance, w.title,
               row_number() over (partition by d.provenance order by d.recorded_at, d.id) as n
        from work_item_delivery_events d
        join evidence_work_items w on w.id = d.work_item_id and w.account_id = d.account_id and w.client_id = d.client_id
        where d.account_id = ${accountId}::uuid and d.client_id = ${clientId}::uuid and d.kind = 'attest'
          and d.recorded_at >= ${start}::timestamptz and d.recorded_at < ${end}::timestamptz
          and not exists (select 1 from work_item_delivery_events x where x.account_id = d.account_id
            and x.target_attestation_id = d.id and x.kind = 'withdraw')
      ) t where t.n <= ${MONTH_DELIVERY_LIST_LIMIT} order by t.recorded_at, t.id`,
  ])
  const c = counts[0] ?? {}
  const delivery = (r: Record<string, unknown>): MonthDelivery => ({ attestationId: String(r.id), workItemId: String(r.work_item_id),
    title: String(r.title ?? ''), versionId: String(r.version_id), recordedAt: iso(r.recorded_at), siteEditJobId: r.site_edit_job_id ? String(r.site_edit_job_id) : null })
  return {
    workItemsOpened: Number(c.opened ?? 0), workItemsDone: Number(c.done ?? 0), siteEditsSent: Number(c.sent ?? 0),
    receiptsCompleted: Number(c.completed ?? 0), receiptsRejected: Number(c.rejected ?? 0),
    verifiedLive: deliveries.filter(r => r.provenance === 'verified_live').map(delivery),
    selfReported: deliveries.filter(r => r.provenance === 'self_reported').map(delivery),
  }
}

/** Weeks of Pulse a month's movement rule judges: the rollups whose week starts inside the Hong Kong month. */
export async function readMonthPulseWeeks(accountId: string, clientId: string, period: BrandMonthPeriod): Promise<{ platform: string; week: string; sov: number | null; answers: number | null }[]> {
  const rows = await db()`
    select s.platform, s.scan_week::text as week, s.sov_score::float8 as sov, s.total_queries::int as answers
    from pulse_weekly_summary s join clients c on c.id = s.client_id and c.account_id = ${accountId}::uuid
    where s.client_id = ${clientId}::uuid and s.platform is not null
      and s.scan_week >= ${period.month}::date and s.scan_week < ${period.month}::date + interval '1 month'
    order by s.platform, s.scan_week`
  return rows.map(r => ({ platform: String(r.platform), week: String(r.week), sov: num(r.sov), answers: num(r.answers) }))
}

export type BrandMonth =
  | { state: 'not_found' }
  | { state: 'ok'; brandName: string; snapshots: MonthSnapshot[]; activity: MonthActivity }

/** The month view: the recorded snapshots (if any) and the derived activity. Reads only. */
export async function readBrandMonth(accountId: string, clientId: string, period: BrandMonthPeriod): Promise<BrandMonth> {
  const sql = db()
  const [client] = await sql`select brand_name, domain from clients where id = ${clientId}::uuid and account_id = ${accountId}::uuid`
  if (!client) return { state: 'not_found' }
  const [rows, activity] = await Promise.all([
    sql`select kind, as_of, taken_at, figures from brand_month_snapshots
      where account_id = ${accountId}::uuid and client_id = ${clientId}::uuid and month = ${period.month}::date order by kind desc`,
    readActivity(accountId, clientId, period),
  ])
  return {
    state: 'ok', brandName: String(client.brand_name ?? client.domain ?? ''), activity,
    snapshots: rows.map(r => ({ kind: r.kind as SnapshotKind, asOf: iso(r.as_of), takenAt: iso(r.taken_at), figures: r.figures as SnapshotFigures })),
  }
}

/**
 * Records whichever snapshots are due and missing (Q4: automatic, not an
 * operator decision). Idempotent: an existing snapshot is never rewritten, and
 * a concurrent writer simply loses the `on conflict`. Ownership is inside the
 * insert, so a foreign brand records nothing.
 */
export async function recordDueSnapshots(accountId: string, clientId: string, period: BrandMonthPeriod, now: Date): Promise<{ state: 'not_found' } | { state: 'ok'; recorded: SnapshotKind[] }> {
  const sql = db()
  const [client] = await sql`select c.id, coalesce(array_agg(s.kind) filter (where s.kind is not null), '{}') as kinds
    from clients c left join brand_month_snapshots s on s.account_id = c.account_id and s.client_id = c.id and s.month = ${period.month}::date
    where c.id = ${clientId}::uuid and c.account_id = ${accountId}::uuid group by c.id`
  if (!client) return { state: 'not_found' }
  const have = new Set(client.kinds as string[])
  const recorded: SnapshotKind[] = []
  for (const kind of dueSnapshots(period, now).filter(k => !have.has(k))) {
    const asOf = asOfFor(period, kind)
    const figures = await computeFigures(accountId, clientId, asOf)
    const rows = await sql`insert into brand_month_snapshots (account_id, client_id, month, kind, as_of, figures)
      select c.account_id, c.id, ${period.month}::date, ${kind}, ${asOf}::timestamptz, ${JSON.stringify(figures)}::jsonb
      from clients c where c.id = ${clientId}::uuid and c.account_id = ${accountId}::uuid
      on conflict (account_id, client_id, month, kind) do nothing returning kind`
    if (rows[0]) recorded.push(kind)
  }
  return { state: 'ok', recorded }
}
