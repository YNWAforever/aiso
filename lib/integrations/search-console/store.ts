import 'server-only'
import { db } from '@/lib/db'
import type { CommercialAccount } from '@/lib/tier'
import type { SealedToken } from '@/lib/integrations/google/vault'
import type { ConnectionStatus, SyncOutcome } from './state'
import type { AnalyticsRow } from './client'

/**
 * All SQL for the Search Console connector. Tenancy is inside every statement:
 * each names account_id, so a caller cannot address another account's row by
 * passing its id. Zero rows means "absent or not yours"; callers answer 404
 * without distinguishing them. Named `returning` columns only.
 */

export type ConnectionSummary = {
  id: string
  googleEmail: string | null
  status: ConnectionStatus
  scopes: string[]
  createdAt: string
}

export type BindingRow = {
  connectionId: string
  siteUrl: string
  permissionLevel: string
  boundDomain: string
  backfillPending: boolean
  connectionStatus: ConnectionStatus
  currentDomain: string | null
  /** When this binding was made or last rebound (ISO). Ledger rows and metrics older than it are about a previous binding. */
  boundAt: string
}

export type DueBinding = {
  accountId: string
  clientId: string
  connectionId: string
  siteUrl: string
  /** Google's level at bind time; the sync re-runs eligibility with it. */
  permissionLevel: string
  boundDomain: string
  currentDomain: string | null
  backfillPending: boolean
  account: CommercialAccount
}

export type DailyMetric = {
  date: string
  scope: 'property' | 'page'
  pageUrl: string | null
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type PageQueryMetric = { pageUrl: string; date: string; query: string } & Omit<AnalyticsRow, 'keys'>

export type MetricTotals = Pick<DailyMetric, 'clicks' | 'impressions' | 'ctr' | 'position'>

export type PanelData = {
  latest: { outcome: SyncOutcome; dataThrough: string | null; ranAt: string } | null
  lastGoodDataThrough: string | null
  property: MetricTotals | null
  pages: Array<{ pageUrl: string } & MetricTotals>
}

const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value))

export async function upsertConnection(input: {
  accountId: string
  profileId: string
  subject: string
  email: string | null
  scopes: string[]
  sealed: SealedToken
}): Promise<string> {
  const sql = db()
  const rows = await sql`
    insert into google_connections
      (account_id, google_subject, google_email, scopes, token_ciphertext, token_key_id, status, connected_by)
    values (${input.accountId}, ${input.subject}, ${input.email}, ${input.scopes}::text[],
            ${input.sealed.ciphertext}, ${input.sealed.keyId}, 'active', ${input.profileId})
    on conflict (account_id, google_subject) do update set
      google_email = excluded.google_email,
      scopes = excluded.scopes,
      token_ciphertext = excluded.token_ciphertext,
      token_key_id = excluded.token_key_id,
      status = 'active',
      connected_by = excluded.connected_by,
      updated_at = now()
    returning id
  `
  const id = rows[0]?.id
  if (typeof id !== 'string') throw new Error('google_connections upsert returned no row')
  return id
}

export async function listConnections(accountId: string): Promise<ConnectionSummary[]> {
  const sql = db()
  const rows = await sql`
    select id, google_email, status, scopes, created_at
    from google_connections
    where account_id = ${accountId}
    order by created_at, id
  `
  return rows.map(r => ({
    id: String(r.id),
    googleEmail: (r.google_email as string | null) ?? null,
    status: r.status as ConnectionStatus,
    scopes: (r.scopes as string[] | null) ?? [],
    createdAt: iso(r.created_at),
  }))
}

export async function loadConnectionSecret(
  accountId: string,
  connectionId: string,
): Promise<{ status: ConnectionStatus; sealed: SealedToken | null } | null> {
  const sql = db()
  const rows = await sql`
    select status, token_ciphertext, token_key_id
    from google_connections
    where account_id = ${accountId} and id = ${connectionId}
    limit 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    status: row.status as ConnectionStatus,
    sealed: row.token_ciphertext && row.token_key_id
      ? { ciphertext: Buffer.from(row.token_ciphertext as Uint8Array), keyId: String(row.token_key_id) }
      : null,
  }
}

export async function markConnection(accountId: string, connectionId: string, status: 'needs_reconnect'): Promise<void> {
  const sql = db()
  await sql`
    update google_connections set status = ${status}, updated_at = now()
    where account_id = ${accountId} and id = ${connectionId} and status = 'active'
  `
}

/** Unbinds every brand on the connection and deletes the credential, atomically. */
export async function revokeConnectionRow(accountId: string, connectionId: string): Promise<boolean> {
  const sql = db()
  const [revoked] = await sql.transaction([
    sql`
      update google_connections
      set status = 'revoked', token_ciphertext = null, token_key_id = null, updated_at = now()
      where account_id = ${accountId} and id = ${connectionId}
      returning id
    `,
    sql`delete from search_console_bindings where account_id = ${accountId} and connection_id = ${connectionId}`,
  ])
  return (revoked as unknown[]).length > 0
}

/**
 * One statement: the brand and the connection are both constrained to the
 * account inside it, and the connection must be active. False means one of them
 * is absent, not this account's, or unusable.
 */
export async function bindProperty(input: {
  accountId: string
  clientId: string
  connectionId: string
  siteUrl: string
  permissionLevel: string
  boundDomain: string
  profileId: string
}): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    insert into search_console_bindings
      (account_id, client_id, connection_id, site_url, permission_level, bound_domain, backfill_pending, bound_by)
    select c.account_id, c.id, g.id, ${input.siteUrl}, ${input.permissionLevel}, ${input.boundDomain}, true, ${input.profileId}
    from clients c
    join google_connections g on g.id = ${input.connectionId} and g.account_id = c.account_id and g.status = 'active'
    where c.id = ${input.clientId} and c.account_id = ${input.accountId}
    for share of g
    on conflict (account_id, client_id) do update set
      connection_id = excluded.connection_id,
      site_url = excluded.site_url,
      permission_level = excluded.permission_level,
      bound_domain = excluded.bound_domain,
      backfill_pending = true,
      bound_by = excluded.bound_by,
      bound_at = now()
    returning client_id
  `
  return rows.length > 0
}

export async function unbindProperty(accountId: string, clientId: string): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    delete from search_console_bindings
    where account_id = ${accountId} and client_id = ${clientId}
    returning client_id
  `
  return rows.length > 0
}

export async function loadBinding(accountId: string, clientId: string): Promise<BindingRow | null> {
  const sql = db()
  const rows = await sql`
    select b.connection_id, b.site_url, b.permission_level, b.bound_domain, b.backfill_pending, b.bound_at,
           g.status as connection_status, c.domain as current_domain
    from search_console_bindings b
    join google_connections g on g.id = b.connection_id and g.account_id = b.account_id
    join clients c on c.id = b.client_id and c.account_id = b.account_id
    where b.account_id = ${accountId} and b.client_id = ${clientId}
    limit 1
  `
  const r = rows[0]
  if (!r) return null
  return {
    connectionId: String(r.connection_id),
    siteUrl: String(r.site_url),
    permissionLevel: String(r.permission_level),
    boundDomain: String(r.bound_domain),
    backfillPending: Boolean(r.backfill_pending),
    connectionStatus: r.connection_status as ConnectionStatus,
    currentDomain: (r.current_domain as string | null) ?? null,
    boundAt: iso(r.bound_at),
  }
}

/**
 * The cron's selection and the one account-blind statement here, by design, like
 * alert evaluation. Each row carries its own account_id and every write the sync
 * makes uses that value. Anything ATTEMPTED in the last 20 hours is not due, and
 * the rest go least recently attempted first: `last_run` is the newest ledger
 * row of ANY outcome, not the newest `ok`. A brand whose run was `deferred`
 * (out of time) therefore has a fresh row and goes behind every brand not yet
 * attempted, so one oversized backfill cannot be retried first every day and
 * starve the brands behind it. Never-attempted brands sort first (nulls first).
 */
export async function loadDueBindings(limit: number): Promise<DueBinding[]> {
  const sql = db()
  const rows = await sql`
    select b.account_id, b.client_id, b.connection_id, b.site_url, b.permission_level, b.bound_domain,
           b.backfill_pending, c.domain as current_domain,
           jsonb_build_object(
             'plan', a.plan, 'status', a.status, 'stripe_subscription_id', a.stripe_subscription_id,
             'trial_ends_at', a.trial_ends_at, 'override_plan', a.override_plan,
             'override_expires_at', a.override_expires_at
           ) as account
    from search_console_bindings b
    join google_connections g on g.id = b.connection_id and g.account_id = b.account_id
    join clients c on c.id = b.client_id and c.account_id = b.account_id
    join accounts a on a.id = b.account_id
    left join lateral (
      select max(r.ran_at) as ran_at from search_console_sync_runs r
      where r.account_id = b.account_id and r.client_id = b.client_id
    ) last_run on true
    where g.status = 'active'
      and (last_run.ran_at is null or last_run.ran_at < now() - interval '20 hours')
    order by last_run.ran_at asc nulls first, b.client_id
    limit ${limit}
  `
  return rows.map(r => ({
    accountId: String(r.account_id),
    clientId: String(r.client_id),
    connectionId: String(r.connection_id),
    siteUrl: String(r.site_url),
    permissionLevel: String(r.permission_level),
    boundDomain: String(r.bound_domain),
    currentDomain: (r.current_domain as string | null) ?? null,
    backfillPending: Boolean(r.backfill_pending),
    account: r.account as CommercialAccount,
  }))
}

/** Oldest-registered first, capped (spec §4.3). */
export async function listSyncPages(accountId: string, clientId: string, cap: number): Promise<string[]> {
  const sql = db()
  const rows = await sql`
    select url from client_assets
    where account_id = ${accountId} and client_id = ${clientId} and char_length(url) <= 2048
    order by created_at, id
    limit ${cap}
  `
  return rows.map(r => String(r.url))
}

export async function writeDaily(accountId: string, clientId: string, metrics: DailyMetric[]): Promise<number> {
  if (!metrics.length) return 0
  const sql = db()
  const rows = await sql`
    insert into search_console_daily
      (account_id, client_id, date, scope, page_url, clicks, impressions, ctr, position)
    select ${accountId}, ${clientId}, d::date, s, p, cl, im, ct, po
    from unnest(
      ${metrics.map(m => m.date)}::text[], ${metrics.map(m => m.scope)}::text[],
      ${metrics.map(m => m.pageUrl)}::text[], ${metrics.map(m => m.clicks)}::int[],
      ${metrics.map(m => m.impressions)}::int[], ${metrics.map(m => m.ctr)}::float8[],
      ${metrics.map(m => m.position)}::float8[]
    ) as t(d, s, p, cl, im, ct, po)
    on conflict on constraint search_console_daily_unique do update set
      clicks = excluded.clicks, impressions = excluded.impressions,
      ctr = excluded.ctr, position = excluded.position, synced_at = now()
    returning 1
  `
  return rows.length
}

export type QueryWindow = { startDate: string; endDate: string; pageUrls: string[] }

/**
 * Replaces the top queries for the re-fetched window, in one transaction. Google
 * revises recent days, and a query that drops out of a day's top 25 would
 * otherwise stay forever with stale numbers — pulse_metrics' class of bug.
 * Replacing a window Google itself revised is not deleting history; only this
 * table grants DELETE (migration 054).
 */
export async function writePageQueries(
  accountId: string,
  clientId: string,
  metrics: PageQueryMetric[],
  window: QueryWindow,
): Promise<number> {
  if (!window.pageUrls.length) return 0
  const sql = db()
  const [, inserted] = await sql.transaction([
    sql`
      delete from search_console_page_queries
      where account_id = ${accountId} and client_id = ${clientId}
        and page_url = any(${window.pageUrls}::text[])
        and date between ${window.startDate}::date and ${window.endDate}::date
    `,
    sql`
      insert into search_console_page_queries
        (account_id, client_id, page_url, date, query, clicks, impressions, ctr, position)
      select ${accountId}, ${clientId}, p, d::date, q, cl, im, ct, po
      from unnest(
        ${metrics.map(m => m.pageUrl)}::text[], ${metrics.map(m => m.date)}::text[],
        ${metrics.map(m => m.query)}::text[], ${metrics.map(m => m.clicks)}::int[],
        ${metrics.map(m => m.impressions)}::int[], ${metrics.map(m => m.ctr)}::float8[],
        ${metrics.map(m => m.position)}::float8[]
      ) as t(p, d, q, cl, im, ct, po)
      returning 1
    `,
  ])
  return (inserted as unknown[]).length
}

export async function recordRun(input: {
  accountId: string
  clientId: string
  siteUrl: string
  connectionId: string
  outcome: SyncOutcome
  rowsWritten: number
  dataThrough: string | null
  clearBackfill: boolean
}): Promise<void> {
  const sql = db()
  await sql.transaction([
    sql`
      insert into search_console_sync_runs (account_id, client_id, outcome, rows_written, data_through)
      values (${input.accountId}, ${input.clientId}, ${input.outcome}, ${input.rowsWritten}, ${input.dataThrough}::date)
    `,
    sql`
      update search_console_bindings set backfill_pending = false
      where account_id = ${input.accountId} and client_id = ${input.clientId}
        and site_url = ${input.siteUrl} and connection_id = ${input.connectionId} and ${input.clearBackfill}::boolean
    `,
  ])
}

/**
 * 28-day totals ending at the newest stored date. CTR and position are
 * impression-weighted: a day with 3 impressions must not count as much as a day
 * with 3,000.
 */
export async function loadPanelData(accountId: string, clientId: string): Promise<PanelData> {
  const sql = db()
  const [runs, lastGood, totals] = await sql.transaction([
    sql`
      select outcome, data_through::text as data_through, ran_at
      from search_console_sync_runs
      where account_id = ${accountId} and client_id = ${clientId}
      order by ran_at desc
      limit 1
    `,
    sql`
      select max(data_through)::text as last_good
      from search_console_sync_runs
      where account_id = ${accountId} and client_id = ${clientId} and outcome = 'ok'
    `,
    sql`
      select scope, page_url,
             sum(clicks)::bigint as clicks, sum(impressions)::bigint as impressions,
             case when sum(impressions) = 0 then 0 else sum(clicks)::float8 / sum(impressions) end as ctr,
             case when sum(impressions) = 0 then 0 else sum(position * impressions) / sum(impressions) end as position
      from search_console_daily
      where account_id = ${accountId} and client_id = ${clientId}
        and date > (
          select coalesce(max(date), current_date) from search_console_daily
          where account_id = ${accountId} and client_id = ${clientId}
        ) - 28
      group by scope, page_url
      order by scope, page_url
    `,
  ], { isolationLevel: 'RepeatableRead', readOnly: true })
  const run = (runs as Array<Record<string, unknown>>)[0]
  const all = totals as Array<Record<string, unknown>>
  const metric = (r: Record<string, unknown>): MetricTotals => ({
    clicks: Number(r.clicks), impressions: Number(r.impressions), ctr: Number(r.ctr), position: Number(r.position),
  })
  const property = all.find(r => r.scope === 'property')
  return {
    latest: run
      ? { outcome: run.outcome as SyncOutcome, dataThrough: (run.data_through as string | null) ?? null, ranAt: iso(run.ran_at) }
      : null,
    lastGoodDataThrough: ((lastGood as Array<Record<string, unknown>>)[0]?.last_good as string | null) ?? null,
    property: property ? metric(property) : null,
    pages: all.filter(r => r.scope === 'page').map(r => ({ pageUrl: String(r.page_url), ...metric(r) })),
  }
}
