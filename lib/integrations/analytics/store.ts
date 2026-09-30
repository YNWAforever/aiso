import 'server-only'
import { db } from '@/lib/db'
import type { CommercialAccount } from '@/lib/tier'
import { SOURCE_CLASSES, type SourceClass } from './sources'
import type { AnalyticsOutcome } from './state'

/**
 * All SQL for the GA4 conversions connector. Tenancy is inside every statement:
 * each names account_id, so a caller cannot address another account's row by
 * passing its id. Zero rows means "absent or not yours"; callers answer 404
 * without distinguishing them. Named `returning` columns only.
 *
 * Deliberately independent of lib/localTrust: the owner figures are read with this
 * file's own SQL, so the two products share a table, not a module.
 */

export type AnalyticsBinding = {
  connectionId: string
  /** The connection's live status. bindStream allows a non-active connection, so the owner state needs it. */
  connectionStatus: 'active' | 'needs_reconnect' | 'revoked'
  propertyId: string
  streamId: string
  streamHost: string
  keyEvents: string[]
  /** When the owner last saved the chosen events (ISO). */
  eventsChosenAt: string
  /** When a different connection, property or stream was last bound (ISO). Older ledger rows and metrics are about a previous binding. */
  boundAt: string
  backfillPending: boolean
}

export type DueAnalyticsBinding = AnalyticsBinding & {
  accountId: string
  clientId: string
  currentDomain: string | null
  account: CommercialAccount
}

export type DailyCount = { date: string; eventName: string; sourceClass: SourceClass; count: number }

export type AnalyticsPanel = {
  /** The newest ledger row of any outcome, for the owner state only. */
  latest: { outcome: AnalyticsOutcome; dataThrough: string | null; ranAt: string } | null
  /** The newest `ok` run of this binding: the window end it asked GA4 for, which dates the figures. */
  lastGoodDataThrough: string | null
  /**
   * Whether GA4 withheld rows in that same run. Read from the row that produced the
   * figures, never the newest row: an `ok` (withheld) followed by a `quota` still
   * shows the withheld run's numbers, so its note must stay.
   */
  lastGoodDataWithheld: boolean
  /** The 28 days ending at lastGoodDataThrough. Null exactly when there is no good run; zeros are real. */
  last28: {
    total: number
    bySource: Record<SourceClass, number>
    byEvent: Array<{ eventName: string; count: number }>
  } | null
  /** Text, as the driver returns numeric columns. Null means "not entered", which a stored 0 is not. */
  owner: { leadValue: string | null; closeRate: string | null }
}

type Row = Record<string, unknown>

const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value))

function toBinding(r: Row): AnalyticsBinding {
  return {
    connectionId: String(r.connection_id),
    connectionStatus: r.connection_status as AnalyticsBinding['connectionStatus'],
    propertyId: String(r.property_id),
    streamId: String(r.stream_id),
    streamHost: String(r.stream_host),
    keyEvents: (r.key_events as string[] | null) ?? [],
    eventsChosenAt: iso(r.events_chosen_at),
    boundAt: iso(r.bound_at),
    backfillPending: Boolean(r.backfill_pending),
  }
}

/**
 * One statement: the brand and the connection are both constrained to the account
 * inside it, so 'not_found' means one of them is absent or not this account's.
 * Only the connection's existence is required, not its status: an owner can bind
 * against a connection that needs reconnecting, and the derived state then says so.
 *
 * bound_at moves only when the connection, property or stream changes. Re-saving
 * the same stream with different events leaves it alone, because data already
 * synced for events that stay chosen remains valid; the events and the backfill
 * flag are reset every time.
 */
export async function bindStream(input: {
  accountId: string
  clientId: string
  connectionId: string
  propertyId: string
  streamId: string
  streamHost: string
  keyEvents: string[]
}): Promise<'bound' | 'not_found'> {
  const sql = db()
  const rows = await sql`
    insert into analytics_bindings
      (account_id, client_id, connection_id, property_id, stream_id, stream_host,
       key_events, events_chosen_at, backfill_pending)
    select c.account_id, c.id, g.id, ${input.propertyId}, ${input.streamId}, ${input.streamHost},
           ${input.keyEvents}::text[], now(), true
    from clients c
    join google_connections g on g.id = ${input.connectionId} and g.account_id = c.account_id
    where c.id = ${input.clientId} and c.account_id = ${input.accountId}
    for share of g
    on conflict on constraint analytics_bindings_account_client_unique do update set
      bound_at = case
        when analytics_bindings.connection_id is distinct from excluded.connection_id
          or analytics_bindings.property_id is distinct from excluded.property_id
          or analytics_bindings.stream_id is distinct from excluded.stream_id
        then now() else analytics_bindings.bound_at end,
      connection_id = excluded.connection_id,
      property_id = excluded.property_id,
      stream_id = excluded.stream_id,
      stream_host = excluded.stream_host,
      key_events = excluded.key_events,
      events_chosen_at = now(),
      backfill_pending = true,
      updated_at = now()
    returning client_id
  `
  return rows.length > 0 ? 'bound' : 'not_found'
}

/** Re-choosing events re-arms the backfill (their history was never fetched) but leaves bound_at alone. */
export async function updateKeyEvents(accountId: string, clientId: string, keyEvents: string[]): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    update analytics_bindings
    set key_events = ${keyEvents}::text[], events_chosen_at = now(), backfill_pending = true, updated_at = now()
    where account_id = ${accountId} and client_id = ${clientId}
    returning client_id
  `
  return rows.length > 0
}

export async function unbindStream(accountId: string, clientId: string): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    delete from analytics_bindings
    where account_id = ${accountId} and client_id = ${clientId}
    returning client_id
  `
  return rows.length > 0
}

/**
 * The brand, if it is this account's. The guard's ownership lookup lives here, not
 * in lib/localTrust, so the observed layer imports nothing from the modelled one
 * (__tests__/security/outcome-layer-separation.test.ts). Zero rows means absent or
 * not yours, and the caller cannot tell which.
 */
export async function loadOwnedClient(
  accountId: string,
  clientId: string,
): Promise<{ id: string; domain: string | null } | null> {
  const sql = db()
  const rows = await sql`
    select id, domain
    from clients
    where id = ${clientId} and account_id = ${accountId}
    limit 1
  `
  const r = rows[0]
  return r ? { id: String(r.id), domain: (r.domain as string | null) ?? null } : null
}

export async function loadAnalyticsBinding(accountId: string, clientId: string): Promise<AnalyticsBinding | null> {
  const sql = db()
  const rows = await sql`
    select b.connection_id, g.status as connection_status, b.property_id, b.stream_id, b.stream_host,
           b.key_events, b.events_chosen_at, b.bound_at, b.backfill_pending
    from analytics_bindings b
    join google_connections g on g.id = b.connection_id and g.account_id = b.account_id
    where b.account_id = ${accountId} and b.client_id = ${clientId}
    limit 1
  `
  const r = rows[0]
  return r ? toBinding(r) : null
}

/**
 * The cron's selection and the one account-blind statement here, by design, like
 * loadDueBindings in the Search Console store and alert evaluation. Each row
 * carries its own account_id and every write the sync makes uses that value.
 *
 * CROSS-ACCOUNT READ. Every account_id below is a join — g.account_id =
 * b.account_id, c.account_id = b.account_id, a.id = b.account_id, the ledger
 * lateral on b.account_id — so each binding stays paired with its own account's
 * connection, brand, plan and ledger, but nothing restricts WHICH account: it
 * selects across all of them. That is the point (the cron has no session), and it
 * is declared as such in __tests__/security/tenancy-inventory.test.ts
 * (ACCOUNT_BLIND_BY_DESIGN), whose token rule would otherwise count it scoped.
 * Never call this from a session-scoped route.
 *
 * Anything ATTEMPTED in the last 20 hours is not due, and the rest go least
 * recently attempted first: `last_run` is the newest ledger row of ANY outcome,
 * not the newest `ok`. A brand whose run was `deferred` (out of time) therefore
 * has a fresh row and goes behind every brand not yet attempted, so one oversized
 * backfill cannot be retried first every day and starve the brands behind it.
 * Never-attempted brands sort first (nulls first).
 */
export async function loadDueAnalyticsBindings(limit: number): Promise<DueAnalyticsBinding[]> {
  const sql = db()
  const rows = await sql`
    select b.account_id, b.client_id, b.connection_id, g.status as connection_status,
           b.property_id, b.stream_id, b.stream_host, b.key_events, b.events_chosen_at, b.bound_at, b.backfill_pending,
           c.domain as current_domain,
           jsonb_build_object(
             'plan', a.plan, 'status', a.status, 'stripe_subscription_id', a.stripe_subscription_id,
             'trial_ends_at', a.trial_ends_at, 'override_plan', a.override_plan,
             'override_expires_at', a.override_expires_at
           ) as account
    from analytics_bindings b
    join google_connections g on g.id = b.connection_id and g.account_id = b.account_id
    join clients c on c.id = b.client_id and c.account_id = b.account_id
    join accounts a on a.id = b.account_id
    left join lateral (
      select max(r.ran_at) as ran_at from analytics_sync_runs r
      where r.account_id = b.account_id and r.client_id = b.client_id
    ) last_run on true
    where g.status = 'active'
      and (last_run.ran_at is null or last_run.ran_at < now() - interval '20 hours')
    order by last_run.ran_at asc nulls first, b.client_id
    limit ${limit}
  `
  return rows.map(r => ({
    ...toBinding(r),
    accountId: String(r.account_id),
    clientId: String(r.client_id),
    currentDomain: (r.current_domain as string | null) ?? null,
    account: r.account as CommercialAccount,
  }))
}

/**
 * Replaces the re-fetched window, in one transaction. Google revises recent days,
 * and a source that dropped to zero (or an event no longer chosen) would otherwise
 * keep its old count forever — pulse_metrics' class of bug. It runs even with no
 * counts, because an empty window is exactly the case where stale rows must go.
 *
 * Rows are inserted as given, not merged: the caller aggregates (one row per date,
 * event and class), and a duplicate from a wrong caller must fail loudly on
 * analytics_daily_unique rather than be summed into an inflated count.
 */
export async function replaceDailyWindow(
  accountId: string,
  clientId: string,
  window: { startDate: string; endDate: string },
  counts: DailyCount[],
): Promise<number> {
  const sql = db()
  const [, inserted] = await sql.transaction([
    sql`
      delete from analytics_daily
      where account_id = ${accountId} and client_id = ${clientId}
        and date between ${window.startDate}::date and ${window.endDate}::date
    `,
    sql`
      insert into analytics_daily (account_id, client_id, date, event_name, source_class, count)
      select ${accountId}::uuid, ${clientId}::uuid, d::date, e, s, n
      from unnest(
        ${counts.map(c => c.date)}::text[], ${counts.map(c => c.eventName)}::text[],
        ${counts.map(c => c.sourceClass)}::text[], ${counts.map(c => c.count)}::bigint[]
      ) as t(d, e, s, n)
      returning 1
    `,
  ])
  return (inserted as unknown[]).length
}

/**
 * The ledger is append-only. The plain identity columns record which binding this
 * run synced; the backfill flag is cleared only where the binding still is that
 * connection, property and stream, so a rebind that happened mid-sync keeps its
 * own pending backfill. The same holds for a re-pick of the events mid-sync: the
 * flag clears only where events_chosen_at is still the value this run synced, so a
 * finishing run cannot clear the backfill the new events still need. events_chosen_at
 * is microsecond-precision and the ISO string is millisecond, hence date_trunc.
 */
export async function recordAnalyticsRun(input: {
  accountId: string
  clientId: string
  connectionId: string
  propertyId: string
  streamId: string
  /** The binding's events_chosen_at (ISO) this run synced. A later re-pick must keep its own pending backfill. */
  eventsChosenAt: string
  outcome: AnalyticsOutcome
  rowsWritten: number
  dataThrough: string | null
  dataWithheld: boolean
  clearBackfill: boolean
}): Promise<void> {
  const sql = db()
  await sql.transaction([
    sql`
      insert into analytics_sync_runs
        (account_id, client_id, connection_id, property_id, stream_id, outcome, rows_written, data_through, data_withheld)
      values (${input.accountId}, ${input.clientId}, ${input.connectionId}, ${input.propertyId}, ${input.streamId},
              ${input.outcome}, ${input.rowsWritten}, ${input.dataThrough}::date, ${input.dataWithheld})
    `,
    sql`
      update analytics_bindings set backfill_pending = false
      where account_id = ${input.accountId} and client_id = ${input.clientId}
        and connection_id = ${input.connectionId} and property_id = ${input.propertyId}
        and stream_id = ${input.streamId}
        and date_trunc('milliseconds', events_chosen_at) = ${input.eventsChosenAt}::timestamptz
        and ${input.clearBackfill}::boolean
    `,
  ])
}

/**
 * 28-day totals of the chosen events, ending at the last good run's data_through.
 *
 * The window is anchored on the ledger, never on the newest stored row: GA4 omits
 * zero-event days, so a brand whose last enquiry was weeks ago has no recent row,
 * and anchoring on max(date) would sum those old 28 days under a "last 28 days"
 * label. Every `ok` run records the window end it asked for (sync.ts), so the
 * last good run says how far the data runs even when it found nothing. The
 * window is `data_through - 28 < date <= data_through`, and the daily statement
 * picks that run with the same predicate and order as the lastGood statement.
 *
 * Only what was synced under the CURRENT binding is shown: analytics_daily is keyed
 * by brand, not by stream, and GA4 omits zero days, so after a rebind the days the
 * new stream does not return would otherwise keep the old stream's numbers. Every
 * row is stamped `synced_at` on insert, so `synced_at >= boundAt` is exactly
 * "written for this binding"; the last good run is limited the same way by the
 * ledger's `ran_at`. Rows from before stay in the table as history; they are just
 * not presented. Events no longer chosen are filtered out too (`event_name = any`),
 * which is why a re-pick changes the totals without deleting anything.
 *
 * `last28` is null exactly when there is no good run of this binding; once there
 * is one it is a real total, zeros included ("0 observed enquiries").
 *
 * The four reads share one read-only repeatable-read snapshot so a sync landing
 * between them cannot pair one run's ledger row with another run's counts.
 */
export async function loadAnalyticsPanel(
  accountId: string,
  clientId: string,
  keyEvents: string[],
  boundAt: string,
): Promise<AnalyticsPanel> {
  const sql = db()
  const [runs, lastGood, daily, profile] = await sql.transaction([
    sql`
      select outcome, data_through::text as data_through, ran_at
      from analytics_sync_runs
      where account_id = ${accountId} and client_id = ${clientId}
      order by ran_at desc
      limit 1
    `,
    sql`
      select data_through::text as data_through, data_withheld
      from analytics_sync_runs
      where account_id = ${accountId} and client_id = ${clientId} and outcome = 'ok'
        and ran_at >= ${boundAt}::timestamptz and data_through is not null
      order by ran_at desc
      limit 1
    `,
    sql`
      with good as (
        select data_through
        from analytics_sync_runs
        where account_id = ${accountId} and client_id = ${clientId} and outcome = 'ok'
          and ran_at >= ${boundAt}::timestamptz and data_through is not null
        order by ran_at desc
        limit 1
      )
      select d.event_name, d.source_class, sum(d.count)::bigint as total
      from analytics_daily d
      cross join good g
      where d.account_id = ${accountId} and d.client_id = ${clientId}
        and d.event_name = any(${keyEvents}::text[])
        and d.synced_at >= ${boundAt}::timestamptz
        and d.date > g.data_through - 28
        and d.date <= g.data_through
      group by d.event_name, d.source_class
    `,
    sql`
      select average_lead_value::text as lead_value, close_rate::text as close_rate
      from local_trust_profiles
      where client_id = ${clientId} and account_id = ${accountId}
      limit 1
    `,
  ], { isolationLevel: 'RepeatableRead', readOnly: true })

  const run = (runs as Row[])[0]
  const good = (lastGood as Row[])[0]
  const owner = (profile as Row[])[0]
  const dailyRows = daily as Row[]

  let last28: AnalyticsPanel['last28'] = null
  if (good) {
    const bySource = Object.fromEntries(SOURCE_CLASSES.map(c => [c, 0])) as Record<SourceClass, number>
    const byEvent = new Map<string, number>()
    let total = 0
    for (const r of dailyRows) {
      const count = Number(r.total)
      const sourceClass = r.source_class as SourceClass
      if (sourceClass in bySource) bySource[sourceClass] += count
      byEvent.set(String(r.event_name), (byEvent.get(String(r.event_name)) ?? 0) + count)
      total += count
    }
    last28 = {
      total,
      bySource,
      byEvent: [...byEvent]
        .map(([eventName, count]) => ({ eventName, count }))
        .sort((a, b) => b.count - a.count || (a.eventName < b.eventName ? -1 : a.eventName > b.eventName ? 1 : 0)),
    }
  }

  return {
    latest: run
      ? {
          outcome: run.outcome as AnalyticsOutcome,
          dataThrough: (run.data_through as string | null) ?? null,
          ranAt: iso(run.ran_at),
        }
      : null,
    lastGoodDataThrough: (good?.data_through as string | null) ?? null,
    lastGoodDataWithheld: Boolean(good?.data_withheld),
    last28,
    owner: {
      leadValue: (owner?.lead_value as string | null) ?? null,
      closeRate: (owner?.close_rate as string | null) ?? null,
    },
  }
}
