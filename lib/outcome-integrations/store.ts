import 'server-only'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { OutcomeError, type AnalyticsEvent, type ClusterInput, type DeploymentInput } from './input'

export type OutcomeScope = { accountId: string; clientId: string }
export type OutcomeAttempt = { id: string; status: string; reason: string | null; startedAt: string }
export const outcomeHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value)
const absent = (): never => { throw new OutcomeError('OUTCOME_NOT_FOUND', 404) }
const conflict = (): never => { throw new OutcomeError('OUTCOME_INTENT_CONFLICT', 409) }
const unavailable = (): never => { throw new OutcomeError('OUTCOME_UNAVAILABLE', 503) }

export async function ingestAnalytics(scope: OutcomeScope, events: AnalyticsEvent[]) {
  const sql = db()
  const input = events.map(event => ({ event_key: event.eventId, occurred_at: event.occurredAt, page_url: event.pageUrl,
    sessions: event.sessions, conversions: event.conversions, revenue_minor: event.revenueMinor, currency: event.currency,
    payload_hash: outcomeHash({ eventId: event.eventId, occurredAt: event.occurredAt, pageUrl: event.pageUrl, sessions: event.sessions, conversions: event.conversions, revenueMinor: event.revenueMinor, currency: event.currency }) }))
  // A separate lock statement gives the insert a fresh ReadCommitted snapshot.
  // The whole batch is refused on a changed replay; no partial new rows land.
  const [owned, written, saved] = await sql.transaction([
    sql`select id from clients where account_id=${scope.accountId}::uuid and id=${scope.clientId}::uuid for update`,
    sql`with input as (select * from jsonb_to_recordset(${JSON.stringify(input)}::jsonb)
      as x(event_key text,occurred_at timestamptz,page_url text,sessions int,conversions int,revenue_minor bigint,currency text,payload_hash text)),
    clashes as (select 1 from outcome_events e join input i on i.event_key=e.event_key
      where e.account_id=${scope.accountId}::uuid and e.client_id=${scope.clientId}::uuid and e.payload_hash<>i.payload_hash)
    insert into outcome_events(account_id,client_id,event_key,payload_hash,kind,occurred_at,page_url,sessions,conversions,revenue_minor,currency)
    select ${scope.accountId}::uuid,c.id,i.event_key,i.payload_hash,'analytics',i.occurred_at,i.page_url,i.sessions,i.conversions,i.revenue_minor,i.currency
      from input i cross join clients c where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and not exists(select 1 from clashes)
    on conflict(account_id,client_id,event_key) do nothing returning event_key`,
    sql`select event_key,payload_hash from outcome_events where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid
      and event_key=any(${input.map(event => event.event_key)}::text[])`,
  ], { isolationLevel: 'ReadCommitted' })
  if (!owned.length) absent()
  if (saved.some(row => input.find(event => event.event_key === row.event_key)?.payload_hash !== row.payload_hash)) conflict()
  if (saved.length !== input.length) unavailable()
  return { accepted: written.length, replayed: input.length - written.length }
}

export async function saveCluster(scope: OutcomeScope, input: ClusterInput) {
  const sql = db()
  const rows = await sql`insert into outcome_query_clusters(account_id,client_id,name,keywords,target_url)
    select ${scope.accountId}::uuid,c.id,${input.name},${input.keywords}::text[],${input.targetUrl}
    from clients c where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid
    on conflict(account_id,client_id,name) do nothing returning id,name,keywords,target_url`
  if (rows[0]) return { id: String(rows[0].id), name: String(rows[0].name), keywords: rows[0].keywords as string[], targetUrl: String(rows[0].target_url) }
  const previous = await sql`select id,name,keywords,target_url from outcome_query_clusters where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and name=${input.name}`
  if (!previous[0]) absent()
  if (previous[0].target_url !== input.targetUrl || JSON.stringify(previous[0].keywords) !== JSON.stringify(input.keywords)) conflict()
  return { id: String(previous[0].id), name: String(previous[0].name), keywords: previous[0].keywords as string[], targetUrl: String(previous[0].target_url) }
}

function attempt(row: Record<string, unknown>): OutcomeAttempt {
  return { id: String(row.id), status: String(row.status), reason: row.reason as string | null, startedAt: iso(row.started_at) }
}
export async function beginOutcomeAttempt(scope: OutcomeScope, kind: string, intentKey: string, request: Record<string, unknown>) {
  const sql = db(), hash = outcomeHash(request)
  const rows = await sql`insert into outcome_attempts(account_id,client_id,kind,intent_key,request_hash,request)
    select ${scope.accountId}::uuid,c.id,${kind},${intentKey},${hash},${JSON.stringify(request)}::jsonb from clients c
    where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid
    on conflict(account_id,client_id,kind,intent_key) do nothing returning id,status,reason,started_at`
  if (rows[0]) return { claimed: true, attempt: attempt(rows[0]) }
  const old = await sql`select id,status,reason,started_at,request_hash from outcome_attempts
    where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and kind=${kind} and intent_key=${intentKey}`
  if (!old[0]) absent()
  if (old[0].request_hash !== hash) conflict()
  return { claimed: false, attempt: attempt(old[0]) }
}

export async function finishOutcomeAttempt(scope: OutcomeScope, attemptId: string, status: string, reason: string, httpStatus: number | null = null) {
  const sql = db()
  const rows = await sql`with finished as (
    update outcome_attempts set status=${status},reason=${reason},http_status=${httpStatus},finished_at=clock_timestamp()
    where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and id=${attemptId}::uuid and status='running'
    returning id,account_id,client_id,status,reason)
  insert into outcome_attempt_receipts(account_id,client_id,attempt_id,status,reason)
    select account_id,client_id,id,status,reason from finished returning attempt_id`
  if (rows.length) return
  const old = await sql`select status,reason from outcome_attempt_receipts where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and attempt_id=${attemptId}::uuid`
  if (!old[0]) absent()
  if (old[0].status !== status || old[0].reason !== reason) conflict()
}

export async function recordOutcomeDeployment(scope: OutcomeScope, input: DeploymentInput) {
  const sql = db(), hash = outcomeHash(input)
  const [row] = await sql`insert into outcome_deployments(account_id,client_id,intent_key,external_id,request_hash,deployed_at,urls,baseline_scan_id,work_item_id,baseline)
    select ${scope.accountId}::uuid,c.id,${input.intentKey},${input.externalId},${hash},${input.deployedAt}::timestamptz,${JSON.stringify(input.urls)}::jsonb,
      ${input.baselineScanId}::uuid,${input.workItemId}::uuid,
      (select jsonb_build_object('scanId',s.id,'score',s.score,'url',s.url,'recordedAt',s.created_at,'evidence',s.results->'evidence')
       from scans s where s.account_id=${scope.accountId}::uuid and s.client_id=c.id and s.id=${input.baselineScanId}::uuid and s.created_at<=${input.deployedAt}::timestamptz)
    from clients c where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid
      and (${input.baselineScanId}::uuid is null or exists(select 1 from scans s where s.account_id=${scope.accountId}::uuid and s.client_id=c.id and s.id=${input.baselineScanId}::uuid and s.created_at<=${input.deployedAt}::timestamptz))
      and (${input.workItemId}::uuid is null or exists(select 1 from evidence_work_items w where w.account_id=${scope.accountId}::uuid and w.client_id=c.id and w.id=${input.workItemId}::uuid))
    on conflict do nothing returning id,external_id`
  if (row) return { id: String(row.id), externalId: String(row.external_id) }
  const [old] = await sql`select id,external_id,request_hash from outcome_deployments where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid
    and (intent_key=${input.intentKey} or external_id=${input.externalId}) order by recorded_at limit 1`
  if (!old) absent()
  if (old.request_hash !== hash) conflict()
  return { id: String(old.id), externalId: String(old.external_id) }
}

export async function readOutcomeData(scope: OutcomeScope, window: { start: string; end: string }) {
  const sql = db()
  const [client] = await sql`select id,domain from clients where account_id=${scope.accountId}::uuid and id=${scope.clientId}::uuid`
  if (!client) return null
  const [clusters, analytics, retrieval, deployments, attempts, regressions, settings] = await Promise.all([
    sql`select id,name,keywords,target_url from outcome_query_clusters where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by name,id limit 50`,
    sql`select page_url,currency,sum(sessions)::text as sessions,sum(conversions)::text as conversions,sum(revenue_minor)::text as revenue_minor,count(*)::int as samples
      from outcome_events where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and kind='analytics' and occurred_at>=${window.start}::date and occurred_at<${window.end}::date+1 group by page_url,currency order by page_url,currency limit 200`,
    sql`select crawler,retrieval_verification,count(*)::int as requests from outcome_events where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and kind='crawler'
      and occurred_at>=${window.start}::date and occurred_at<${window.end}::date+1 group by crawler,retrieval_verification order by crawler limit 50`,
    sql`select id,external_id,deployed_at,recorded_at,urls,baseline,work_item_id from outcome_deployments where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by deployed_at desc limit 50`,
    sql`select id,kind,status,reason,http_status,started_at,finished_at from outcome_attempts where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by started_at desc limit 50`,
    sql`select id,deployment_id,rule,state,evidence,created_at from outcome_regressions where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by created_at desc limit 100`,
    sql`select indexnow_key,bound_domain,score_drop_points,outcome_drop_percent,minimum_samples from outcome_integration_settings where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid`,
  ])
  return { clientId: String(client.id), domain: String(client.domain), clusters, analytics, retrieval, deployments, attempts, regressions, settings: settings[0] ?? null }
}
