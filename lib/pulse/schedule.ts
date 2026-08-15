import type { db } from '@/lib/db'
import { runtimePlatformsFor } from '@/lib/pulse/platforms'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'

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
  prompt_count: number | string
  scanned_prompts: number | string
}

/**
 * Clients whose weekly Pulse run has not finished, oldest brand first.
 *
 * **"Finished" is the aggregate `pulse_weekly_summary` row, not the presence of
 * metrics.** `pulse/run` writes that row only on the chunk where nextCursor
 * comes back null, so it means the whole bank completed. Testing `pulse_metrics`
 * instead would make a client that finished one chunk look done — the worst
 * possible false negative for a resumable driver.
 *
 * The cursor is derived rather than stored: it is how many of the client's
 * prompts already have metrics for this week. `pulse/run` orders prompts by id
 * and processes them in order, so the scanned set is a prefix and its size is
 * the resume point. Deriving it means there is no cursor to get out of sync with
 * reality, and an interrupted run resumes correctly with no bookkeeping.
 *
 * The known imprecision: deactivating a prompt mid-week shrinks the active list,
 * so the derived cursor can point a place or two off and a few prompts get
 * rescanned. Harmless — the rollup is idempotent — and much cheaper than the
 * cursor table it avoids.
 *
 * Entitlement is deliberately NOT expressed in SQL. Migration 026 has a SQL
 * translation of the plan rules, but it predates `override_plan` and so is blind
 * to comped accounts; copying it here would silently skip a paying customer.
 * The over-inclusive prefilter below can only admit clients TypeScript then
 * rejects, never exclude one it would have accepted.
 */
export async function selectPendingClients(sql: Sql, limit: number): Promise<PendingClient[]> {
  const rows = await sql`
    select c.id as client_id,
           (select count(*) from prompt_bank pb
             where pb.client_id = c.id and pb.is_active) as prompt_count,
           (select count(distinct m.prompt_id) from pulse_metrics m
             where m.client_id = c.id
               and m.scan_week = date_trunc('week', now())::date) as scanned_prompts,
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
              and s.scan_week = date_trunc('week', now())::date
              and s.platform is null
          )
      -- Over-inclusive on purpose; the real decision is made below.
      and (a.override_plan is not null or a.plan in ('basic', 'pro', 'enterprise'))
      and (a.override_plan is not null or a.status not in ('past_due', 'cancelled'))
    order by c.created_at, c.id
    limit ${limit}
  `

  return (rows as unknown as CandidateRow[])
    .filter(row => {
      const entitlement = resolveCommercialEntitlement(row as CommercialAccount)
      // A plan granting no platforms is refused 403 by pulse/run anyway; skipping
      // here is what stops the driver burning its whole budget on those refusals.
      return runtimePlatformsFor(entitlement.features.platform_access).length > 0
    })
    .map(row => ({
      clientId: row.client_id,
      promptCount: Number(row.prompt_count),
      cursor: Number(row.scanned_prompts),
    }))
    .filter(c => c.promptCount > 0)
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
