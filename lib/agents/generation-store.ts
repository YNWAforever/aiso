import { db } from '@/lib/db'
import type { CommercialAccount } from '@/lib/tier'
import type { AgentRequirements } from '@/lib/agents'
import { modelVariantsFor } from '@/lib/openrouter'
import { runtimePlatformsFor } from '@/lib/pulse/platforms'
import type { AgentGenerationReceipt } from './generation-state'

export type GenerationScope = { accountId: string; clientId: string; scanId: string }
export type GenerationScan = NonNullable<CommercialAccount> & {
  id: string; results: Record<string, unknown>; agent_status: string | null; webhook_url: string | null; commercial_snapshot: unknown
}
export type GenerationInputGuard = { evidence: unknown; commercial: unknown; entitlementExpiresAt: string | null }
export type NativeRecommendation = { platform: string; category: string; priority: string; recommendation: string; impact_score: number }
export type MeasuredProgress = { platform: string; metric: string; current_value: number; previous_value: null; delta: null; week: string; classified: number; mentioned: number }

export async function readGenerationScan({ accountId, clientId, scanId }: GenerationScope): Promise<GenerationScan | null> {
  const rows = await db()`select s.id, s.results, s.agent_status, c.webhook_url,
    a.plan, a.status, a.stripe_subscription_id, a.trial_ends_at, a.override_plan, a.override_expires_at,
    jsonb_build_array(a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at) as commercial_snapshot
    from scans s join clients c on c.id=s.client_id and c.account_id=s.account_id
    join accounts a on a.id=s.account_id
    where s.id=${scanId} and s.client_id=${clientId} and s.account_id=${accountId}
      and c.account_id=${accountId} limit 1`
  return (rows[0] as GenerationScan | undefined) ?? null
}

/** CAS binds the claim to the exact receipt read; a racing consumer cannot replace it. */
export async function claimGeneration(scope: GenerationScope, receipt: AgentGenerationReceipt, previous: unknown, requirements: AgentRequirements, platforms: string[], guard: GenerationInputGuard) {
  const { accountId, clientId, scanId } = scope
  const rows = await db()`update scans s set agent_status='running', agent_platforms=${platforms}::text[],
    results=coalesce(s.results,'{}'::jsonb)||jsonb_build_object('_agent_generation',${JSON.stringify(receipt)}::jsonb,'_agent_requirements',${JSON.stringify(requirements)}::jsonb)
    where s.id=${scanId} and s.client_id=${clientId} and s.account_id=${accountId}
      and (s.results->'_agent_generation') is not distinct from ${previous == null ? null : JSON.stringify(previous)}::jsonb
      and s.agent_status is distinct from 'complete'
      and s.results->'evidence' is not distinct from ${guard.evidence === undefined ? null : JSON.stringify(guard.evidence)}::jsonb
      and exists(select 1 from accounts a where a.id=${accountId}
        and jsonb_build_array(a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at)=${JSON.stringify(guard.commercial)}::jsonb)
      and exists(select 1 from clients c where c.id=s.client_id and c.account_id=${accountId} and c.webhook_url is null)
    returning s.id`
  return rows.length === 1
}

/** Persisted BEFORE crossing the provider boundary: uncertain outcomes never trigger another call. */
export async function markProviderStarted(scope: GenerationScope, receipt: AgentGenerationReceipt, guard: GenerationInputGuard) {
  const { accountId, clientId, scanId } = scope
  const rows = await db()`update scans s set results=jsonb_set(s.results,'{_agent_generation,providerStarted}','true'::jsonb)
    from accounts a where s.id=${scanId} and s.client_id=${clientId} and s.account_id=${accountId} and a.id=s.account_id
      and s.results#>>'{_agent_generation,token}'=${receipt.token} and s.results#>>'{_agent_generation,state}'='running'
      and s.results#>>'{_agent_generation,fingerprint}'=${receipt.fingerprint}
      and (s.results#>>'{_agent_generation,leaseUntil}')::timestamptz>clock_timestamp()
      and (${guard.entitlementExpiresAt}::timestamptz is null or ${guard.entitlementExpiresAt}::timestamptz>clock_timestamp())
      and s.results->'evidence' is not distinct from ${guard.evidence === undefined ? null : JSON.stringify(guard.evidence)}::jsonb
      and jsonb_build_array(a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at)=${JSON.stringify(guard.commercial)}::jsonb
      and exists(select 1 from clients c where c.id=s.client_id and c.account_id=${accountId} and c.webhook_url is null)
    returning s.id`
  return rows.length === 1
}

export async function readMeasuredProgress({ accountId, clientId }: GenerationScope, platforms: string[]): Promise<MeasuredProgress[]> {
  // Retained legacy rows can use entitlement labels; current Pulse stores the
  // runtime variant keys. Both are admitted only through the live plan's map.
  const allowedPlatforms = [...new Set([...platforms, ...modelVariantsFor(runtimePlatformsFor(platforms)).map(variant => variant.platform)])]
  const rows = await db()`with observations as materialized (
      select m.id,m.platform,m.scan_week,m.brand_mentioned,m.raw_answer,m.classification_status from pulse_metrics m
      join clients c on c.id=m.client_id and c.account_id=${accountId}
      where m.client_id=${clientId} and c.account_id=${accountId} and m.platform=any(${allowedPlatforms}::text[])
        and (m.run_item_id is null or exists(select 1 from pulse_run_items i
          join pulse_runs r on r.id=i.run_id and r.account_id=i.account_id and r.client_id=i.client_id
          where i.id=m.run_item_id and i.client_id=${clientId} and i.account_id=${accountId} and r.purpose='canonical'))
    ) select platform,scan_week::text as week,count(*)::int as classified,
      count(*) filter(where brand_mentioned)::int as mentioned
      from observations where scan_week=(select max(scan_week) from observations)
        and raw_answer ~ '[^[:space:]]' and classification_status='classified' and brand_mentioned is not null
      group by platform,scan_week order by platform`
  return rows.map(row => ({ platform: String(row.platform), metric: 'observed_mention_rate',
    current_value: Number(row.mentioned) * 100 / Number(row.classified), previous_value: null, delta: null,
    week: String(row.week), classified: Number(row.classified), mentioned: Number(row.mentioned) }))
}

/** All outputs and completion share one PostgreSQL statement and the same tenant/token fence. */
export async function commitGeneration(scope: GenerationScope, receipt: AgentGenerationReceipt, recommendations: NativeRecommendation[], progress: MeasuredProgress[], guard: GenerationInputGuard) {
  const { accountId, clientId, scanId } = scope
  const rows = await db()`with owned as materialized (
      select s.id from scans s join clients c on c.id=s.client_id and c.account_id=s.account_id
      join accounts a on a.id=s.account_id
      where s.id=${scanId} and s.client_id=${clientId} and s.account_id=${accountId} and c.account_id=${accountId}
        and s.results#>>'{_agent_generation,token}'=${receipt.token} and s.results#>>'{_agent_generation,state}'='running'
        and s.results#>>'{_agent_generation,fingerprint}'=${receipt.fingerprint}
        and (s.results#>>'{_agent_generation,leaseUntil}')::timestamptz>clock_timestamp()
        and (${guard.entitlementExpiresAt}::timestamptz is null or ${guard.entitlementExpiresAt}::timestamptz>clock_timestamp())
        and s.results->'evidence' is not distinct from ${guard.evidence === undefined ? null : JSON.stringify(guard.evidence)}::jsonb
        and jsonb_build_array(a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at)=${JSON.stringify(guard.commercial)}::jsonb
        and c.webhook_url is null
      for update of s
    ), recs as (
      insert into agent_recommendations(scan_id,platform,category,priority,recommendation,impact_score)
      select o.id,r.platform,r.category,r.priority,r.recommendation,r.impact_score from owned o
      cross join jsonb_to_recordset(${JSON.stringify(recommendations)}::jsonb)
        as r(platform text,category text,priority text,recommendation text,impact_score smallint)
      on conflict(scan_id,platform,category) do update set priority=excluded.priority,recommendation=excluded.recommendation,impact_score=excluded.impact_score
      returning scan_id
    ), metrics as (
      insert into agent_progress(scan_id,platform,metric,current_value,previous_value,delta)
      select o.id,p.platform,p.metric,p.current_value,p.previous_value,p.delta from owned o
      cross join jsonb_to_recordset(${JSON.stringify(progress)}::jsonb)
        as p(platform text,metric text,current_value numeric,previous_value numeric,delta numeric)
      on conflict(scan_id,platform,metric) do update set current_value=excluded.current_value,previous_value=excluded.previous_value,delta=excluded.delta
      returning scan_id
    ) update scans s set agent_status='complete',results=jsonb_set(s.results,'{_agent_generation}',${JSON.stringify(receipt)}::jsonb)
      from owned where s.id=owned.id and s.account_id=${accountId}
        and (select count(*) from recs)>=0 and (select count(*) from metrics)>=0 returning s.id`
  return rows.length === 1
}

export async function failGeneration(scope: GenerationScope, receipt: AgentGenerationReceipt) {
  const { accountId, clientId, scanId } = scope
  await db()`update scans set agent_status='error',results=jsonb_set(results,'{_agent_generation}',${JSON.stringify(receipt)}::jsonb)
    where id=${scanId} and client_id=${clientId} and account_id=${accountId}
      and results#>>'{_agent_generation,token}'=${receipt.token} and results#>>'{_agent_generation,state}'='running'`
}
