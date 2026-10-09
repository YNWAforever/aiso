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
  cursor_created_at: string
  prompt_count: number | string
  scanned_prompts: number | string
}

/**
 * Candidates read per round trip. Independent of `limit` on purpose: the
 * eligibility decision happens after the query, so the page has to be big
 * enough that a run of ineligible clients costs one query, not one per client.
 */
const CANDIDATE_PAGE = 50

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
 *
 * **Because the decision is made after the query, `limit` must not be applied
 * in SQL.** It was, and a single ineligible oldest client (an expired trial
 * still holding an active prompt bank) then filled the one-row page, filtered
 * out to nothing, and — never getting a rollup — stayed first in line every
 * week, so no younger client was ever scanned. The query now pages through the
 * candidates by (created_at, id) until `limit` eligible ones are found or the
 * candidates run out.
 */
export async function selectPendingClients(
  sql: Sql,
  limit: number,
  // Clients the caller already tried and saw fail in this pass; passed over so
  // one broken client cannot hold the head of the queue.
  exclude: ReadonlySet<string> = new Set(),
): Promise<PendingClient[]> {
  const pending: PendingClient[] = []
  let cursor: { createdAt: string; id: string } | null = null

  while (pending.length < limit) {
    const rows = await selectCandidatePage(sql, cursor)
    for (const row of rows) {
      const client = exclude.has(row.client_id) ? null : eligiblePendingClient(row)
      if (client) pending.push(client)
      if (pending.length >= limit) break
    }
    if (rows.length < CANDIDATE_PAGE) break
    const last = rows[rows.length - 1]
    cursor = { createdAt: last.cursor_created_at, id: last.client_id }
  }

  return pending
}

function eligiblePendingClient(row: CandidateRow): PendingClient | null {
  const entitlement = resolveCommercialEntitlement(row as CommercialAccount)
  // A plan granting no platforms is refused 403 by pulse/run anyway; skipping
  // here is what stops the driver burning its whole budget on those refusals.
  if (runtimePlatformsFor(entitlement.features.platform_access).length === 0) return null
  const promptCount = Number(row.prompt_count)
  if (promptCount <= 0) return null
  return { clientId: row.client_id, promptCount, cursor: Number(row.scanned_prompts) }
}

async function selectCandidatePage(
  sql: Sql,
  cursor: { createdAt: string; id: string } | null,
): Promise<CandidateRow[]> {
  const cursorAt = cursor?.createdAt ?? null
  const cursorId = cursor?.id ?? null
  // created_at travels as text so the keyset comparison round-trips at full
  // precision; a JS Date would truncate microseconds and could skip a row.
  const rows = await sql`
    select c.id as client_id,
           c.created_at::text as cursor_created_at,
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
      and (${cursorAt}::timestamptz is null
           or (c.created_at, c.id) > (${cursorAt}::timestamptz, ${cursorId}::uuid))
    order by c.created_at, c.id
    limit ${CANDIDATE_PAGE}
  `
  return rows as unknown as CandidateRow[]
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
