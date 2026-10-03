import type { db } from '@/lib/db'
import { runtimePlatformsFor } from '@/lib/pulse/platforms'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'
import { isFeatureEnabled } from '@/lib/flags'

type Sql = ReturnType<typeof db>

export type PendingClient = {
  readonly clientId: string
  readonly cursor: number
  readonly promptCount: number
}

/**
 * Rows the selection query returns: one candidate client plus the account
 * columns entitlement resolution needs.
 */
type CandidateRow = Record<string, unknown> & {
  client_id: string
  created_at: string | Date
  prompt_count: number | string
  scanned_prompts: number | string
}

/**
 * Clients whose weekly Pulse run has not finished, oldest brand first.
 *
 * With pulse_attempts enabled, completion is the immutable run manifest's
 * completed status. The item ledger handles continuation, so cursor is zero.
 * Flag-off compatibility retains the historical summary marker and derived
 * prompt count; those markers cannot prove complete question/model coverage.
 *
 * Entitlement is deliberately NOT expressed in SQL. Migration 026 has a SQL
 * translation of the plan rules, but it predates `override_plan` and so is blind
 * to comped accounts; copying it here would silently skip a paying customer.
 * The over-inclusive prefilter below can only admit clients TypeScript then
 * rejects, never exclude one it would have accepted.
 */
export type CandidateCursor = { createdAt: string; clientId: string }
export type PendingClientPage = { items: PendingClient[]; nextCursor: CandidateCursor | null; exhausted: boolean; scanned: number }

export function currentScanWeek(now = new Date()): string {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
  return monday.toISOString().slice(0, 10)
}

export async function selectPendingClientPage(sql: Sql, options: {
  limit: number; after?: CandidateCursor | null; scanWeek: string; deadlineMs: number
}): Promise<PendingClientPage> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000
    || !/^\d{4}-\d{2}-\d{2}$/.test(options.scanWeek)) throw new TypeError('Invalid candidate page')
  const pageSize = Math.max(100, options.limit)
  let cursor = options.after ?? null
  const items: PendingClient[] = []
  let scanned = 0
  while (Date.now() < options.deadlineMs) {
    const rows = isFeatureEnabled('pulse_attempts') ? await sql`
      select c.id as client_id,to_char(c.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,0 as scanned_prompts,
        (select count(*) from prompt_bank pb where pb.client_id=c.id and pb.is_active) as prompt_count,
        a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at
      from clients c join accounts a on a.id=c.account_id
      where c.status='active' and exists(select 1 from prompt_bank pb where pb.client_id=c.id and pb.is_active)
        and not exists(select 1 from pulse_runs r where r.client_id=c.id and r.account_id=c.account_id
          and r.scan_week=${options.scanWeek}::date and r.status='completed')
        and (a.override_plan is not null or a.plan in ('basic','pro','enterprise'))
        and (a.override_plan is not null or a.status not in ('past_due','cancelled'))
        and (${cursor?.createdAt??null}::timestamptz is null or (c.created_at,c.id)>(${cursor?.createdAt??null}::timestamptz,${cursor?.clientId??null}::uuid))
      order by c.created_at,c.id limit ${pageSize}
    ` : await sql`
    select c.id as client_id,to_char(c.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
           (select count(*) from prompt_bank pb
             where pb.client_id = c.id and pb.is_active) as prompt_count,
           (select count(distinct m.prompt_id) from pulse_metrics m
             where m.client_id = c.id
               and m.scan_week = ${options.scanWeek}::date) as scanned_prompts,
           a.plan, a.status, a.stripe_subscription_id, a.trial_ends_at,
           a.override_plan, a.override_expires_at
    from clients c
    join accounts a on a.id = c.account_id
    where exists (
            select 1 from prompt_bank pb
            where pb.client_id = c.id and pb.is_active
          )
      and not exists (
            select 1 from pulse_weekly_summary s
            where s.client_id = c.id
              and s.scan_week = ${options.scanWeek}::date
              and s.platform is null
          )
      -- Over-inclusive on purpose; the real decision is made below.
      and (a.override_plan is not null or a.plan in ('basic', 'pro', 'enterprise'))
      and (a.override_plan is not null or a.status not in ('past_due', 'cancelled'))
      and (${cursor?.createdAt ?? null}::timestamptz is null
        or (c.created_at, c.id) > (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.clientId ?? null}::uuid))
    order by c.created_at, c.id
    limit ${pageSize}
  `
    const candidates = rows as unknown as CandidateRow[]
    for (const [index, row] of candidates.entries()) {
      if (Date.now() >= options.deadlineMs) return { items, nextCursor: cursor, exhausted: false, scanned }
      cursor = { createdAt: typeof row.created_at==='string'?row.created_at:row.created_at.toISOString(), clientId: row.client_id }
      scanned++
      const entitlement = resolveCommercialEntitlement(row as CommercialAccount)
      if (runtimePlatformsFor(entitlement.features.platform_access).length && Number(row.prompt_count) > 0) {
        items.push({ clientId: row.client_id, promptCount: Number(row.prompt_count), cursor: Number(row.scanned_prompts) })
      }
      if (items.length >= options.limit) return { items, nextCursor: cursor,
        exhausted: index === candidates.length - 1 && candidates.length < pageSize, scanned }
    }
    if (candidates.length < pageSize) return { items, nextCursor: cursor, exhausted: true, scanned }
  }
  return { items, nextCursor: cursor, exhausted: false, scanned }
}

export async function selectPendingClients(sql: Sql, limit: number): Promise<PendingClient[]> {
  return (await selectPendingClientPage(sql, { limit, scanWeek: currentScanWeek(), deadlineMs: Date.now() + 40_000 })).items
}

/**
 * Clients with at least one active prompt, regardless of whether this week is
 * already rolled up.
 *
 * selectPendingClients deliberately excludes clients already finished for the
 * week, so an empty pending list means either "everyone is done" or "nobody was
 * ever configured". Only this count separates them.
 */
export async function countConfiguredClients(sql: Sql): Promise<number> {
  const rows = await sql`
    select count(*)::int as n
    from clients c
    where exists (
      select 1 from prompt_bank pb
      where pb.client_id = c.id and pb.is_active
    )
  `
  return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0)
}
