import 'server-only'
import { db } from '@/lib/db'
import { readScanEvidence } from '@/lib/scan-evidence'
import { loadBinding } from '@/lib/integrations/search-console/store'
import { bindingMatchesDomain } from '@/lib/integrations/search-console/binding'
import type { OutcomeScope } from './store'
export async function loadOutcomeSummary(scope: OutcomeScope) {
  const sql = db(), binding = await loadBinding(scope.accountId,scope.clientId)
  const boundAt = binding && bindingMatchesDomain(binding,binding.currentDomain) ? binding.boundAt : null
  const [search, analytics] = await Promise.all([
    sql`select sum(clicks)::float8 as clicks,sum(impressions)::float8 as impressions from search_console_daily
      where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and scope='property'
      and date>=current_date-27 and date<=current_date and synced_at>=${boundAt}::timestamptz
      and exists(select 1 from search_console_bindings b where b.account_id=${scope.accountId}::uuid and b.client_id=${scope.clientId}::uuid and b.bound_at=${boundAt}::timestamptz)`,
    sql`select sum(sessions)::float8 as sessions,sum(conversions)::float8 as conversions from outcome_events
      where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and kind='analytics' and occurred_at>=current_date-27 and occurred_at<current_date+1`,
  ])
  return { search: search[0] ?? null, analytics: analytics[0] ?? null, retrieval: 'unavailable', windowDays: 28 }
}
export async function loadOutcomeMeasurements(scope: OutcomeScope, window: { start: string; end: string }) {
  const sql = db()
  const binding = await loadBinding(scope.accountId, scope.clientId)
  const boundAt = binding && bindingMatchesDomain(binding, binding.currentDomain) ? binding.boundAt : null
  const [technical, search, queries, appearance, sync] = await Promise.all([
    sql`select id,url,score,created_at,results->'evidence' as evidence from scans where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by created_at desc,id desc limit 1`,
    sql`select scope,page_url,sum(clicks)::float8 as clicks,sum(impressions)::float8 as impressions,
      sum(position*impressions)/nullif(sum(impressions),0) as position,count(*)::int as days
      from search_console_daily where synced_at>=${boundAt}::timestamptz and exists(select 1 from search_console_bindings b where b.account_id=${scope.accountId}::uuid and b.client_id=${scope.clientId}::uuid and b.bound_at=${boundAt}::timestamptz) and account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid
      and date>=${window.start}::date and date<=${window.end}::date group by scope,page_url order by scope,page_url limit 100`,
    sql`select page_url,query,sum(clicks)::float8 as clicks,sum(impressions)::float8 as impressions,sum(position*impressions)/nullif(sum(impressions),0) as position
      from search_console_page_queries where synced_at>=${boundAt}::timestamptz and exists(select 1 from search_console_bindings b where b.account_id=${scope.accountId}::uuid and b.client_id=${scope.clientId}::uuid and b.bound_at=${boundAt}::timestamptz) and account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid
      and date>=${window.start}::date and date<=${window.end}::date group by page_url,query order by sum(impressions) desc,page_url,query limit 1000`,
    sql`select page_url,appearance,sum(clicks)::float8 as clicks,sum(impressions)::float8 as impressions,
      sum(position*impressions)/nullif(sum(impressions),0) as position from search_console_appearance where synced_at>=${boundAt}::timestamptz and exists(select 1 from search_console_bindings b where b.account_id=${scope.accountId}::uuid and b.client_id=${scope.clientId}::uuid and b.bound_at=${boundAt}::timestamptz) and account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid
      and date>=${window.start}::date and date<=${window.end}::date group by page_url,appearance order by page_url,appearance limit 200`,
    sql`select outcome,rows_written,data_through,ran_at from search_console_sync_runs where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and ran_at>=${boundAt}::timestamptz order by ran_at desc limit 1`,
  ])
  const scan = technical[0], evidence = readScanEvidence(scan?.evidence)
  return { technical: scan ? { id: scan.id, url: scan.url, score: scan.score, recordedAt: scan.created_at,
    method: evidence?.headlineMethod ?? null, collection: evidence?.collection ?? 'unknown', scope: evidence?.completedScope ?? 'unknown' } : null,
    search, queries, appearance, lastSearchSync: sync[0] ?? null, coverage: { queryLimit: 1000, queryLimitReached: queries.length === 1000, sampledPages: 20, queriesPerPageDate: 25, observedRetrieval: 'no-verified-log-connector' } }
}
