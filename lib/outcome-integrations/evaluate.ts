import 'server-only'
import { db } from '@/lib/db'
import { loadBinding } from '@/lib/integrations/search-console/store'
import { bindingMatchesDomain } from '@/lib/integrations/search-console/binding'
import { readScanEvidence } from '@/lib/scan-evidence'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'
import { PLAN_CATALOG,PLAN_IDS } from '@/lib/plans/catalog'
import { beginOutcomeAttempt, finishOutcomeAttempt, type OutcomeScope } from './store'
import { compareOutcomeCounts, compareOutcomeScores } from './regression'

const stamp = (value: unknown) => new Date(String(value)).toISOString()
const day = (value: string, offset: number) => new Date(Date.parse(value) + offset * 86400000).toISOString().slice(0, 10)
function score(raw: Record<string, unknown> | null) {
  if (!raw) return null
  const evidence = readScanEvidence(raw.evidence)
  return { score: Number(raw.score), url: String(raw.url), signature: evidence?.comparisonSignature ?? null, complete: evidence?.collection === 'complete' }
}
/** Cron-only bounded cross-account due selection. Writes use each row's scope. */
export async function loadDueOutcomeEvaluations(limit = 20) {
  const sql = db()
  return sql`select d.account_id,d.client_id,d.id,days.n as days,a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at
    from outcome_deployments d join accounts a on a.id=d.account_id cross join (values(7),(28),(56)) as days(n)
    where (case
      when a.override_plan=any(${PLAN_IDS}::text[]) and (a.override_expires_at is null or (isfinite(a.override_expires_at) and a.override_expires_at>clock_timestamp())) then a.override_plan
      when a.status in ('past_due','cancelled') then 'free'
      when a.plan=any(${PLAN_IDS.filter(plan=>plan!=='free')}::text[]) and (
        (a.status='active' and length(a.stripe_subscription_id)>0) or (isfinite(a.trial_ends_at) and a.trial_ends_at>clock_timestamp())
        or (a.status='trialing' and length(a.stripe_subscription_id)>0)) then a.plan else 'free' end)
      =any(${PLAN_IDS.filter(plan=>PLAN_CATALOG[plan].features.outcome_integrations)}::text[])
      and d.deployed_at+((days.n+3)||' days')::interval<clock_timestamp()
      and not exists(select 1 from outcome_attempts t where t.account_id=d.account_id and t.client_id=d.client_id
        and t.kind='regression' and t.request->>'deploymentId'=d.id::text and t.request->>'days'=days.n::text
        and (t.status in ('running','succeeded') or t.started_at>clock_timestamp()-interval '20 hours'))
      and (select count(*) from outcome_attempts t where t.account_id=d.account_id and t.client_id=d.client_id and t.kind='regression'
        and t.request->>'deploymentId'=d.id::text and t.request->>'days'=days.n::text)<3
    order by d.deployed_at,days.n,d.id limit ${limit}`
}
export async function evaluateDeployment(scope: OutcomeScope, deploymentId: string, days: number) {
  const sql = db()
  const [d] = await sql`select d.id,d.deployed_at,d.baseline,coalesce(s.score_drop_points,10) as score_drop,
    coalesce(s.outcome_drop_percent,30) as outcome_drop,coalesce(s.minimum_samples,25) as minimum
    from outcome_deployments d left join outcome_integration_settings s on s.account_id=d.account_id and s.client_id=d.client_id
    where d.account_id=${scope.accountId}::uuid and d.client_id=${scope.clientId}::uuid and d.id=${deploymentId}::uuid`
  if (!d || ![7,28,56].includes(days)) return
  const deployed = stamp(d.deployed_at), start = day(deployed, 0), before = day(deployed, -days), end = day(deployed, days)
  const previous = await sql`select status from outcome_attempts where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and kind='regression'
    and request->>'deploymentId'=${deploymentId} and request->>'days'=${String(days)} order by started_at limit 3`
  if (previous.length >= 3 || previous.some(row => ['running','succeeded'].includes(String(row.status)))) return
  const intent = `regression:${deploymentId}:${days}${previous.length ? `:retry:${previous.length}` : ''}`
  const claim = await beginOutcomeAttempt(scope, 'regression', intent, { deploymentId, days, before, start, end })
  if (!claim.claimed) return
  try {
    const binding = await loadBinding(scope.accountId,scope.clientId)
    const boundAt = binding && bindingMatchesDomain(binding,binding.currentDomain) ? binding.boundAt : null
    const [search, analytics, scans] = await Promise.all([
      sql`select case when date<${start}::date then 'before' else 'after' end as period,sum(clicks)::float8 as value,sum(impressions)::float8 as samples
        from search_console_daily where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and scope='property' and synced_at>=${boundAt}::timestamptz and exists(select 1 from search_console_bindings b where b.account_id=${scope.accountId}::uuid and b.client_id=${scope.clientId}::uuid and b.bound_at=${boundAt}::timestamptz)
        and date>=${before}::date and date<${end}::date group by 1`,
      sql`select case when occurred_at<${start}::date then 'before' else 'after' end as period,sum(conversions)::float8 as value,sum(sessions)::float8 as samples
        from outcome_events where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and kind='analytics'
        and occurred_at>=${before}::date and occurred_at<${end}::date group by 1`,
      sql`select score,url,results->'evidence' as evidence from scans where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid
        and created_at>=${deployed}::timestamptz and created_at<${end}::date order by created_at desc,id desc limit 1`,
    ])
    const counts = (rows: Record<string, unknown>[]) => {
      const b = rows.find(row => row.period === 'before'), a = rows.find(row => row.period === 'after')
      return compareOutcomeCounts({ before: Number(b?.value ?? 0), after: Number(a?.value ?? 0), beforeSamples: Number(b?.samples ?? 0), afterSamples: Number(a?.samples ?? 0) }, Number(d.outcome_drop), Number(d.minimum))
    }
    const results = [ { rule: 'score_drop', ...compareOutcomeScores(score(d.baseline), score(scans[0] ?? null), Number(d.score_drop)) },
      { rule: 'search_click_drop', ...counts(search) }, { rule: 'conversion_drop', ...counts(analytics) } ]
    for (const result of results) {
      await sql`with saved as (insert into outcome_regressions(account_id,client_id,deployment_id,window_end,rule,state,evidence)
        select ${scope.accountId}::uuid,d.client_id,d.id,${end}::date,${result.rule},${result.state},${JSON.stringify({ ...result.evidence, window: { before, start, end, days }, coverage: 'reported-sample', limitation: 'association-not-causation' })}::jsonb
        from outcome_deployments d where d.account_id=${scope.accountId}::uuid and d.client_id=${scope.clientId}::uuid and d.id=${deploymentId}::uuid
        on conflict(account_id,client_id,deployment_id,rule,window_end) do nothing returning id,account_id,client_id,state)
        insert into notifications(account_id,client_id,type,title,message,read,outcome_regression_id)
        select account_id,client_id,'outcome_regression','Outcome regression / 成效回落',
          ${`${result.rule}: ${days}-day observed decline; review evidence. / ${days} 天觀察到回落；請檢視證據。`},false,id from saved where state='regressed'
        on conflict(outcome_regression_id) do nothing`
    }
    await finishOutcomeAttempt(scope, claim.attempt.id, 'succeeded', 'EVALUATED')
  } catch {
    await finishOutcomeAttempt(scope, claim.attempt.id, 'failed', 'EVALUATION_UNAVAILABLE')
    throw new Error('OUTCOME_EVALUATION_UNAVAILABLE')
  }
}
/** Repair abandoned work visibly; never repeat an ambiguous external submission. */
export async function repairOutcomeAttempts() {
  const sql = db()
  const rows = await sql`select id,account_id,client_id from outcome_attempts where status='running' and started_at<clock_timestamp()-interval '10 minutes' order by started_at limit 50`
  for (const row of rows) await finishOutcomeAttempt({ accountId: String(row.account_id), clientId: String(row.client_id) }, String(row.id), 'unknown', 'ATTEMPT_INTERRUPTED')
  return rows.length
}
export async function runOutcomeEvaluations() {
  const deadline = Date.now() + 45_000
  const repaired = await repairOutcomeAttempts(), due = await loadDueOutcomeEvaluations()
  let evaluated = 0, skipped = 0, deferred = 0
  for (const row of due) {
    if (Date.now() >= deadline) { deferred++; continue }
    if (!resolveCommercialEntitlement(row as CommercialAccount).features.outcome_integrations) { skipped++; continue }
    await evaluateDeployment({ accountId: String(row.account_id), clientId: String(row.client_id) }, String(row.id), Number(row.days))
    evaluated++
  }
  return { repaired, evaluated, skipped, deferred }
}
