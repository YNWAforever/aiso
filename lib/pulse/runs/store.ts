import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { isoDate } from '@/lib/iso-date'
import { MAX_PROMPTS } from '@/lib/pulse/limits'
import { coverageFromCounts, type AttemptOutput, type LeasedItem, type ModelVariant, type PulseRun, type PulseScope } from './schema'

/** Noninteractive HTTP batch: lock first, then read a fresh snapshot. */
export async function createOrResumeRun(scope: PulseScope, input: { scanWeek: string; manifest: ModelVariant[] }): Promise<PulseRun | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scanWeek) || !input.manifest.length || input.manifest.length > 5
    || new Set(input.manifest.map(v => v.model)).size !== input.manifest.length) throw new Error('Invalid manifest')
  const sql = db()
  const [, result] = await sql.transaction([
    sql`select id from clients where account_id = ${scope.accountId} and id = ${scope.clientId}::uuid for no key update`,
    sql`with prompts as (
      select pb.id, pb.question, pb.category, pb.language, to_jsonb(pb)->>'market' as market
      from prompt_bank pb join clients c on c.id = pb.client_id
      where c.account_id = ${scope.accountId} and c.id = ${scope.clientId}::uuid and pb.is_active
      order by pb.id limit ${MAX_PROMPTS}
    ), snapshot as (
      select jsonb_build_object('version','2026-10-03.v2','brand',jsonb_build_object(
        'name',c.brand_name,'competitors',coalesce(c.competitors,'{}'::text[]),'industry',c.industry,'domain',c.domain,
        -- 061: configured spellings, captured with the manifest so a later edit never rewrites a run.
        'competitorRefs',coalesce((select jsonb_agg(jsonb_build_object('name',k.name,'aliases',k.aliases) order by k.created_at,k.id)
          from competitors k where k.client_id=c.id and k.account_id=c.account_id and k.archived_at is null),'[]'::jsonb)),
        'policy',jsonb_build_object('maxAttempts',3,'maxOutputTokens',500,'maxClassificationAttempts',3,'maxAnalysisOutputTokens',300),
        'items',coalesce((select jsonb_agg(jsonb_build_object('promptId',p.id,'question',p.question,'category',p.category,
          'language',p.language,'market',p.market,'contextVersion','2026-10-03.v1','platform',v->>'platform','model',v->>'model') order by p.id,v->>'model')
          from prompts p cross join jsonb_array_elements(${JSON.stringify(input.manifest)}::jsonb) v),'[]'::jsonb)) as manifest
      from clients c where c.account_id = ${scope.accountId} and c.id = ${scope.clientId}::uuid
    ), created as (
      insert into pulse_runs(account_id,client_id,scan_week,manifest)
      select ${scope.accountId},${scope.clientId}::uuid,${input.scanWeek}::date,manifest from snapshot
      on conflict(client_id,scan_week) do nothing returning *
    ), chosen as (
      select * from created union all select * from pulse_runs
      where account_id = ${scope.accountId} and client_id = ${scope.clientId}::uuid and scan_week = ${input.scanWeek}::date
    ), items as (
      insert into pulse_run_items(run_id,account_id,client_id,prompt_snapshot_id,snapshot,platform,model_id)
      select r.id,r.account_id,r.client_id,(v->>'promptId')::uuid,
        v - 'promptId' - 'platform' - 'model',v->>'platform',v->>'model'
      from chosen r cross join jsonb_array_elements(r.manifest->'items') v
      on conflict(run_id,prompt_snapshot_id,model_id) do nothing returning id
    ) select id,scan_week,manifest from chosen`,
  ])
  const row = result[0]
  return row ? { id: String(row.id), scanWeek: isoDate(row.scan_week as string | Date, input.scanWeek), manifest: row.manifest as Record<string, unknown> } : null
}

export async function claimDueItems(scope: PulseScope, runId: string, options: { owner: string; leaseUntil: Date; limit: number }): Promise<LeasedItem[]> {
  if (!options.owner || options.owner.length > 128 || !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 15
    || options.leaseUntil.getTime() <= Date.now() || options.leaseUntil.getTime() > Date.now() + 120_000) throw new Error('Invalid lease')
  const sql = db(), token = randomUUID()
  // Record uncertain external outcome before recovering an expired lease. A
  // restarted worker may incur another provider charge; it never fabricates $0.
  const [, , , rows] = await sql.transaction([
    // Claim and commit take the run lock first to avoid inverted item/attempt
    // locks when a lease expires while another transaction is finishing.
    sql`select id from pulse_runs where id = ${runId}::uuid and account_id = ${scope.accountId}
      and client_id = ${scope.clientId}::uuid for no key update`,
    sql`update pulse_item_attempts a set collection_status = 'interrupted',finished_at = now(),error_code = 'LEASE_EXPIRED_OUTCOME_UNKNOWN'
      from pulse_run_items i where a.item_id = i.id and a.account_id = ${scope.accountId} and a.client_id = ${scope.clientId}::uuid
        and i.run_id = ${runId}::uuid and i.status = 'running' and i.lease_until < now() and a.collection_status = 'started'`,
    sql`update pulse_run_items set status = 'failed',lease_token = null,lease_until = null,lease_owner = null,updated_at = now()
      where account_id = ${scope.accountId} and client_id = ${scope.clientId}::uuid and run_id = ${runId}::uuid
        and status = 'running' and lease_until < now() and attempt_count >= 3`,
    sql`with due as (
      select id from pulse_run_items where account_id = ${scope.accountId} and client_id = ${scope.clientId}::uuid and run_id = ${runId}::uuid
        and attempt_count < 3 and ((status in ('queued','retry_wait') and next_attempt_at <= now()) or (status = 'running' and lease_until < now()))
      order by prompt_snapshot_id,model_id for update skip locked limit ${options.limit}
    ), claimed as (
      update pulse_run_items i set status = 'running',lease_owner = ${options.owner},lease_token = ${token}::uuid,
        lease_until = ${options.leaseUntil.toISOString()}::timestamptz,fence = fence + 1,attempt_count = attempt_count + 1,updated_at = now()
      where i.id in (select id from due) returning i.*
    ), attempts as (
      insert into pulse_item_attempts(item_id,account_id,client_id,attempt_number,lease_token,fence,requested_model)
      select id,account_id,client_id,attempt_count,lease_token,fence,model_id from claimed returning id,item_id
    ) select i.*,a.id as attempt_id,r.scan_week,r.manifest->'brand' as brand
      from claimed i join attempts a on a.item_id = i.id join pulse_runs r on r.id = i.run_id`,
  ])
  return rows.map(row => ({ ...scope, id: String(row.id), runId, scanWeek: isoDate(row.scan_week as string | Date,''),
    token: String(row.lease_token), fence: Number(row.fence), attempt: Number(row.attempt_count), attemptId: String(row.attempt_id),
    platform: String(row.platform), model: String(row.model_id), snapshot: row.snapshot as LeasedItem['snapshot'], brand: row.brand as LeasedItem['brand'] }))
}

/** Raw provider outcome and projection commit together, before classification. */
export async function commitAttempt(lease: LeasedItem, output: AttemptOutput): Promise<'committed' | 'stale-lease' | 'already-recorded'> {
  const sql = db(), evidence = output.kind === 'succeeded' ? output.evidence : null
  if (evidence && !evidence.answer.trim()) throw new Error('Empty provider answer')
  const [, , rows] = await sql.transaction([
    sql`select id from pulse_runs where id = ${lease.runId}::uuid and account_id = ${lease.accountId}
      and client_id = ${lease.clientId}::uuid for no key update`,
    sql`select id from pulse_run_items where id = ${lease.id}::uuid and account_id = ${lease.accountId} and client_id = ${lease.clientId}::uuid for update`,
    sql`with current as (
      select * from pulse_run_items where id = ${lease.id}::uuid and account_id = ${lease.accountId} and client_id = ${lease.clientId}::uuid
        and status = 'running' and lease_token = ${lease.token}::uuid and fence = ${lease.fence} and lease_until > now()
    ), attempt as (
      update pulse_item_attempts a set collection_status = ${output.kind},accepted = true,finished_at = now(),
        raw_answer = ${evidence?.answer ?? null},actual_model = ${evidence?.actualModel ?? null},provider_request_id = ${evidence?.requestId ?? null},
        prompt_tokens = ${evidence?.promptTokens ?? null},completion_tokens = ${evidence?.completionTokens ?? null},cost_usd = ${evidence?.costUsd ?? null},
        provider_citations = ${evidence?.providerCitations == null ? null : JSON.stringify(evidence.providerCitations)}::jsonb,
        provider_finish_reason = ${evidence?.providerFinishReason ?? null},
        http_status = ${evidence?.httpStatus ?? (output.kind !== 'succeeded' ? output.httpStatus ?? null : null)},
        error_code = ${output.kind !== 'succeeded' ? output.errorCode.slice(0,80) : null}
      from current i where a.id = ${lease.attemptId}::uuid and a.item_id = i.id and a.lease_token = i.lease_token and a.fence = i.fence
        and a.collection_status = 'started' returning a.id
    ), accepted as (
      update pulse_run_items i set status = case when ${output.kind} = 'succeeded' then 'succeeded'
        when ${output.kind} = 'blocked' then 'blocked' when attempt_count >= 3 then 'failed' else 'retry_wait' end,
        next_attempt_at = now() + case attempt_count when 1 then interval '60 seconds' when 2 then interval '300 seconds' else interval '1800 seconds' end,
        accepted_attempt_id = case when ${output.kind} = 'succeeded' then (select id from attempt) else null end,
        lease_token = null,lease_until = null,lease_owner = null,updated_at = now()
      where i.id in (select id from current) and exists(select 1 from attempt) returning i.*
    ), projection as (
      insert into pulse_metrics(client_id,prompt_id,platform,question,raw_answer,scan_week,run_item_id)
      select i.client_id,(select p.id from prompt_bank p where p.id = i.prompt_snapshot_id and p.client_id = i.client_id),
        i.platform,i.snapshot->>'question',${evidence?.answer ?? null},r.scan_week,i.id
      from accepted i join pulse_runs r on r.id = i.run_id where i.status = 'succeeded'
      on conflict(run_item_id) where run_item_id is not null do nothing returning id
    ) select 'committed' as outcome from accepted
      union all select case when accepted_attempt_id = ${lease.attemptId}::uuid then 'already-recorded' else 'stale-lease' end
        from pulse_run_items where id = ${lease.id}::uuid and account_id = ${lease.accountId} and client_id = ${lease.clientId}::uuid
        and not exists(select 1 from accepted)`,
  ])
  return (rows[0]?.outcome ?? 'stale-lease') as 'committed' | 'stale-lease' | 'already-recorded'
}

export async function recordClassification(lease: LeasedItem, classification: {
  status: string; method: string; version: string; brandMentioned: boolean | null; sentiment: string;
  mentionPosition: number | null; competitorsMentioned: string[]; matchedText?: string[]
}): Promise<boolean> {
  const sql = db()
  const rows = await sql`with item as (
    update pulse_run_items set classification_status = ${classification.status},updated_at = now()
    where id = ${lease.id}::uuid and account_id = ${lease.accountId} and client_id = ${lease.clientId}::uuid
      and status = 'succeeded' and accepted_attempt_id = ${lease.attemptId}::uuid and classification_status = 'unknown' returning id
  ), attempt as (
    update pulse_item_attempts set classification = ${JSON.stringify(classification)}::jsonb,
      classifier_method = ${classification.method},classifier_version = ${classification.version}
    where id = ${lease.attemptId}::uuid and item_id in (select id from item)
      and account_id = ${lease.accountId} and client_id = ${lease.clientId}::uuid returning id
  ), projection as (
    update pulse_metrics set classification_status=${classification.status},classifier_method=${classification.method},classifier_version=${classification.version},
      matched_text=${JSON.stringify(classification.matchedText??[])}::jsonb,brand_mentioned = ${classification.brandMentioned},sentiment = ${classification.sentiment},
      mention_position = ${classification.mentionPosition},competitors_mentioned = ${classification.competitorsMentioned}::text[]
    where run_item_id in (select id from item) and client_id = ${lease.clientId}::uuid returning id
  ) select id from item`
  return rows.length === 1
}

export async function readRunCoverage(scope: PulseScope, runId: string) {
  const sql = db()
  const rows = await sql`select count(*)::int as expected,
    count(*) filter(where i.status = 'succeeded')::int as succeeded,
    count(*) filter(where i.status = 'failed')::int as failed,
    count(*) filter(where i.status in ('queued','running','retry_wait'))::int as pending,
    count(*) filter(where i.status = 'blocked')::int as blocked,
    count(*) filter(where i.status = 'succeeded' and i.classification_status = 'classified')::int as classified,
    count(*) filter(where i.status = 'succeeded' and i.classification_status = 'classified' and (a.classification->>'brandMentioned')::boolean)::int as mentioned
    from pulse_run_items i left join pulse_item_attempts a on a.id = i.accepted_attempt_id
    where i.account_id = ${scope.accountId} and i.client_id = ${scope.clientId}::uuid and i.run_id = ${runId}::uuid
      and exists(select 1 from pulse_runs r where r.id = i.run_id and r.account_id = ${scope.accountId})`
  const row = rows[0]
  if (!row) throw new Error('Coverage unavailable')
  const result = coverageFromCounts({ expected:Number(row.expected),succeeded:Number(row.succeeded),failed:Number(row.failed),pending:Number(row.pending),
    blocked:Number(row.blocked),classified:Number(row.classified),mentioned:Number(row.mentioned) })
  await sql`update pulse_runs set status = ${result.status},updated_at = now()
    where id = ${runId}::uuid and account_id = ${scope.accountId} and client_id = ${scope.clientId}::uuid and status <> 'completed'`
  return result
}
