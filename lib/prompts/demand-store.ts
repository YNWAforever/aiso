import 'server-only'
import { db } from '@/lib/db'
import { loadBinding } from '@/lib/integrations/search-console/store'
import { bindingMatchesDomain } from '@/lib/integrations/search-console/binding'
import type { DemandQuery } from './demand'

/** How many days of synced search data the drafts are drawn from, ending at the latest synced day. */
export const DEMAND_WINDOW_DAYS = 28
/** How many top queries are read; the drafter keeps at most 10 non-branded ones. */
export const DEMAND_QUERY_READ_LIMIT = 50

export type DemandInputs =
  | { state: 'not_found' }
  | { state: 'not_connected'; brandName: string; domain: string | null; activeCount: number; questions: string[] }
  | { state: 'ok'; brandName: string; domain: string | null; activeCount: number; questions: string[]
      queries: DemandQuery[]; window: { start: string; end: string } | null }

/**
 * Everything the drafter needs, for one brand in the caller's account.
 *
 * Query rows follow the rule every Search Console reader follows
 * (lib/integrations/search-console/store.ts `loadPanelData`, and
 * lib/outcome-integrations/measurements.ts): only rows synced under the
 * CURRENT binding (`synced_at >= bound_at`) and only while that binding still
 * covers the brand's domain, so a brand never drafts from another site's
 * searches. No binding, or a stale one, reads as `not_connected`, never as
 * "no demand".
 */
export async function readDemandInputs(accountId: string, clientId: string): Promise<DemandInputs> {
  const sql = db()
  const [client] = await sql`
    select c.brand_name, c.domain,
           (select count(*)::int from prompt_bank p where p.client_id = c.id and p.is_active) as active_count,
           coalesce((select array_agg(p.question order by p.id) from prompt_bank p where p.client_id = c.id), '{}') as questions
    from clients c where c.id = ${clientId}::uuid and c.account_id = ${accountId}::uuid`
  if (!client) return { state: 'not_found' }
  const base = { brandName: String(client.brand_name ?? ''), domain: (client.domain as string | null) ?? null,
    activeCount: Number(client.active_count), questions: (client.questions as string[]) ?? [] }

  const binding = await loadBinding(accountId, clientId)
  if (!binding || !bindingMatchesDomain(binding, binding.currentDomain)) return { state: 'not_connected', ...base }
  const boundAt = binding.boundAt
  const rows = await sql`
    with scoped as (
      select q.query, q.clicks, q.impressions, q.position, q.date
      from search_console_page_queries q
      where q.account_id = ${accountId}::uuid and q.client_id = ${clientId}::uuid
        and q.synced_at >= ${boundAt}::timestamptz
        and exists (select 1 from search_console_bindings b where b.account_id = q.account_id and b.client_id = q.client_id
          and b.bound_at = ${boundAt}::timestamptz)
    ), latest as (select max(date) as end_date from scoped)
    select s.query, sum(s.clicks)::float8 as clicks, sum(s.impressions)::float8 as impressions,
           sum(s.position * s.impressions) / nullif(sum(s.impressions), 0) as position,
           (select end_date from latest)::text as end_date,
           ((select end_date from latest) - ${DEMAND_WINDOW_DAYS - 1}::int)::text as start_date
    from scoped s, latest l
    where s.date > l.end_date - ${DEMAND_WINDOW_DAYS}::int
    group by s.query
    order by sum(s.impressions) desc, sum(s.clicks) desc, s.query
    limit ${DEMAND_QUERY_READ_LIMIT}`
  const queries = rows.map(r => ({ query: String(r.query), clicks: Number(r.clicks), impressions: Number(r.impressions),
    position: r.position === null ? null : Number(r.position) }))
  const window = rows[0] ? { start: String(rows[0].start_date), end: String(rows[0].end_date) } : null
  return { state: 'ok', ...base, queries, window }
}
