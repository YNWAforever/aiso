import type { db } from '@/lib/db'

type Sql = ReturnType<typeof db>

/**
 * Normalises any date to the Monday that starts its ISO week.
 *
 * `scan_week` is a `date`, and the two historical producers disagreed about what
 * it meant: the in-app run wrote *today*, the n8n workflow wrote *now − 7 days*.
 * Neither is a week boundary, so two runs in one week produced two "weeks" —
 * which defeats the upsert in migration 031 and makes the week-over-week alert in
 * cron/evaluate-alerts compare a week against itself. One convention, applied by
 * every writer, is the fix. Postgres `date_trunc('week', …)` is Monday-based.
 */
export const WEEK_START_SQL = "date_trunc('week', $1::date)::date"

export type WeeklySummaryResult = {
  readonly scanWeek: string
  readonly platformRows: number
  readonly aggregateRows: number
}

/**
 * Rolls raw `pulse_metrics` up into `pulse_weekly_summary` for one client-week.
 *
 * Writes **both** kinds of row the table was designed for — one per platform and
 * one `platform is null` aggregate — from a single pass, using GROUPING SETS.
 * The aggregate is the one that has never existed: both n8n workflows group by
 * `(client_id, scan_week, platform)` only, and the sole implementation that ever
 * produced it (`scripts/run-pulse.mjs`, deleted in a0075c7) is gone. Everything
 * downstream reads the aggregate — the dashboard KPI in
 * app/api/clients/[clientId]/overview/route.ts, and cron/evaluate-alerts, which
 * filters `platform is null` explicitly.
 *
 * Idempotent: upserts on the unique index from migration 031, which is declared
 * NULLS NOT DISTINCT precisely so the aggregate row participates. Re-running
 * refreshes rather than duplicating.
 */
export async function computeWeeklySummary(
  sql: Sql,
  { clientId, scanWeek }: { clientId: string; scanWeek: string },
): Promise<WeeklySummaryResult> {
  const rows = await sql`
    with metrics as (
      select client_id, scan_week, platform, brand_mentioned, sentiment, competitors_mentioned
      from pulse_metrics
      where client_id = ${clientId}::uuid
        and scan_week = date_trunc('week', ${scanWeek}::date)::date
    ),
    -- Competitor tallies need their own grouping sets: unnesting in the main
    -- query would multiply rows and inflate total_queries.
    competitor_tallies as (
      select m.client_id, m.scan_week, m.platform, c.name, count(*) as mentions
      from metrics m, unnest(coalesce(m.competitors_mentioned, '{}'::text[])) as c(name)
      where c.name is not null and c.name <> ''
      group by grouping sets (
        (m.client_id, m.scan_week, m.platform, c.name),
        (m.client_id, m.scan_week, c.name)
      )
    ),
    competitors as (
      select client_id, scan_week, platform,
             jsonb_object_agg(name, mentions) as top_competitors
      from competitor_tallies
      group by client_id, scan_week, platform
    ),
    rolled as (
      select
        client_id,
        scan_week,
        platform,
        count(*)::int as total_queries,
        count(*) filter (where brand_mentioned)::int as brand_mentions,
        round(
          count(*) filter (where brand_mentioned)::numeric * 100
            / nullif(count(*), 0), 2
        ) as sov_score,
        round(avg(
          case sentiment
            when 'positive' then 1
            when 'neutral'  then 0
            when 'negative' then -1
          end
        ), 2) as avg_sentiment_score
      from metrics
      group by grouping sets (
        (client_id, scan_week, platform),
        (client_id, scan_week)
      )
    )
    insert into pulse_weekly_summary (
      client_id, scan_week, platform, total_queries, brand_mentions,
      sov_score, avg_sentiment_score, top_competitors
    )
    select r.client_id, r.scan_week, r.platform, r.total_queries, r.brand_mentions,
           r.sov_score, r.avg_sentiment_score, c.top_competitors
    from rolled r
    -- "is not distinct from", not "=", so the aggregate row (platform null)
    -- joins its own aggregate tally rather than matching nothing: NULL = NULL
    -- is unknown, so a plain equality join silently drops it.
    left join competitors c
      on c.client_id = r.client_id
     and c.scan_week = r.scan_week
     and c.platform is not distinct from r.platform
    on conflict (client_id, scan_week, platform) do update set
      total_queries       = excluded.total_queries,
      brand_mentions      = excluded.brand_mentions,
      sov_score           = excluded.sov_score,
      avg_sentiment_score = excluded.avg_sentiment_score,
      top_competitors     = excluded.top_competitors
    returning scan_week, platform
  `

  const written = rows as unknown as Array<{ scan_week: string; platform: string | null }>
  return {
    scanWeek: String(written[0]?.scan_week ?? scanWeek),
    platformRows: written.filter(row => row.platform !== null).length,
    aggregateRows: written.filter(row => row.platform === null).length,
  }
}
