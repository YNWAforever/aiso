import 'server-only'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { isoDate } from '@/lib/iso-date'
import { MAX_PROMPTS, PULSE_ANSWER_MAX_TOKENS, pulseAnswerMaxTokens } from '@/lib/pulse/limits'
import { coverageFromCounts, type AttemptOutput, type LeasedItem, type ModelVariant, type PulseRun, type PulseScope, type PulseIntent } from './schema'

/** Noninteractive HTTP batch: lock first, then read a fresh snapshot. */
export async function createOrResumeRun(scope: PulseScope, input: { scanWeek: string; manifest: ModelVariant[];intent?:PulseIntent;dispatch?:{requestHash:string;reservationCap:number} }): Promise<PulseRun | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scanWeek) || !input.manifest.length || input.manifest.length > 5
    || new Set(input.manifest.map(v => v.model)).size !== input.manifest.length) throw new Error('Invalid manifest')
  const sql = db()
  const purpose=input.intent?.kind==='retest'?'retest':'canonical'
  if(input.intent&&!/^[a-zA-Z0-9:_-]{8,128}$/.test(input.intent.intentKey))throw new Error('Invalid intent')
  if(input.intent?.kind==='repair'&&!input.dispatch){const [row]=await sql`select id,scan_week,manifest,purpose from pulse_runs where id=${input.intent.sourceRunId??null}::uuid and account_id=${scope.accountId} and client_id=${scope.clientId}::uuid`;return row?{id:String(row.id),scanWeek:isoDate(row.scan_week as string|Date,''),manifest:row.manifest as Record<string,unknown>,purpose:row.purpose as 'canonical'|'retest'}:null}
  let includeMonitoring=false
  if(isFeatureEnabled('closed_loop_visibility')){const [account]=await sql`select a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at from accounts a join clients c on c.account_id=a.id where a.id=${scope.accountId} and c.id=${scope.clientId}::uuid`;includeMonitoring=resolveCommercialEntitlement(account as CommercialAccount).features.closed_loop_visibility}
  const results = await sql.transaction([
    ...(input.dispatch?[sql`select id from accounts where id=${scope.accountId} for update`]:[]),
    sql`select id from clients where account_id = ${scope.accountId} and id = ${scope.clientId}::uuid for no key update`,
    sql`with prior_intent as (
      select u.request_hash,r.* from pulse_user_intents u join pulse_runs r on r.id=u.run_id and r.account_id=u.account_id and r.client_id=u.client_id
      where ${!!input.dispatch} and u.account_id=${scope.accountId} and u.client_id=${scope.clientId}::uuid and u.intent_key=${input.intent?.intentKey??null}
    ), prompts as (
      select pb.id, pb.question, pb.category, pb.language, to_jsonb(pb)->>'market' as market,to_jsonb(pb)->'monitoring' as monitoring
      from prompt_bank pb join clients c on c.id = pb.client_id
      where c.account_id = ${scope.accountId} and c.id = ${scope.clientId}::uuid and pb.is_active
      order by pb.id limit ${MAX_PROMPTS}
    ), snapshot as (
      select case when ${purpose}='retest' then (select source.manifest from pulse_runs source where source.id=${input.intent?.sourceRunId??null}::uuid and source.account_id=${scope.accountId} and source.client_id=${scope.clientId}::uuid) else jsonb_build_object('version',${includeMonitoring?'2026-10-26.v1':'2026-10-03.v2'}::text,'brand',jsonb_build_object(
        'name',c.brand_name,'competitors',coalesce(c.competitors,'{}'::text[]),'industry',c.industry,'domain',c.domain,
        -- 061: configured spellings, captured with the manifest so a later edit never rewrites a run.
        'competitorRefs',coalesce((select jsonb_agg((jsonb_build_object('name',k.name,'aliases',k.aliases) || case when ${includeMonitoring} then jsonb_build_object('id',k.id,'domains',k.domains) else '{}'::jsonb end) order by k.created_at,k.id)
          from competitors k where k.client_id=c.id and k.account_id=c.account_id and k.archived_at is null),'[]'::jsonb)),
        'policy',jsonb_build_object('maxAttempts',3,'maxOutputTokens',${PULSE_ANSWER_MAX_TOKENS}::int,'maxOutputTokensGeminiFlash',${pulseAnswerMaxTokens('gemini-flash')}::int,'maxClassificationAttempts',3,'maxAnalysisOutputTokens',300),
        'items',coalesce((select jsonb_agg(jsonb_build_object('promptId',p.id,'question',p.question,'category',p.category,
          'language',p.language,'market',p.market,'contextVersion','2026-10-03.v1','sourceSchemaVersion','2026-10-11.v1','platform',v->>'platform','model',v->>'model') || case when ${includeMonitoring} and p.monitoring->>'locale'=p.language and p.monitoring->>'market'=p.market then jsonb_build_object('monitoring',p.monitoring,'contextVersion','2026-10-26.v1') else '{}'::jsonb end order by p.id,v->>'model')
          from prompts p cross join jsonb_array_elements(${JSON.stringify(input.manifest)}::jsonb) v),'[]'::jsonb)) end as manifest
      from clients c where c.account_id = ${scope.accountId} and c.id = ${scope.clientId}::uuid
    ), candidate as (
      select r.* from pulse_runs r where r.account_id=${scope.accountId} and r.client_id=${scope.clientId}::uuid and (
        (${input.intent?.kind??'initial'}='repair' and r.id=${input.intent?.sourceRunId??null}::uuid)
        or (${input.intent?.kind??'initial'}<>'repair' and r.purpose=${purpose} and ((${purpose}='canonical' and r.scan_week=${input.scanWeek}::date) or (${purpose}='retest' and r.intent_key=${input.intent?.intentKey??null}))))
    ), commercial as (
      select case when a.override_plan in ('free','basic','pro','enterprise') and (a.override_expires_at is null or a.override_expires_at>now()) then a.override_plan
        when a.status in ('past_due','cancelled') then 'free'
        when a.plan in ('basic','pro','enterprise') and ((a.status='active' and length(a.stripe_subscription_id)>0) or a.trial_ends_at>now() or (a.status='trialing' and length(a.stripe_subscription_id)>0)) then a.plan else 'free' end as plan
      from accounts a where a.id=${scope.accountId}
    ), gate as (
      select case when not ${!!input.dispatch} then null
       when exists(select 1 from prior_intent where request_hash<>${input.dispatch?.requestHash??null}) then 'PULSE_INTENT_CONFLICT'
       when exists(select 1 from prior_intent) then null
       when not exists(select 1 from commercial where plan in ('basic','pro','enterprise') and (plan<>'basic' or ${input.manifest.every(v=>v.platform==='gemini-flash')})) then 'PULSE_ENTITLEMENT_CHANGED'
       when ${input.intent?.kind??'initial'}='repair' and not exists(select 1 from candidate) then 'PULSE_RUN_NOT_FOUND'
       when ${input.intent?.sourceRunId??null}::uuid is not null and not exists(select 1 from pulse_runs source where source.id=${input.intent?.sourceRunId??null}::uuid and source.account_id=${scope.accountId} and source.client_id=${scope.clientId}::uuid) then 'PULSE_RUN_NOT_FOUND'
       when not exists(select 1 from candidate) and not exists(select 1 from snapshot where jsonb_array_length(manifest->'items')>0) then 'PULSE_NOT_CONFIGURED'
       when not exists(select 1 from candidate) and exists(select 1 from snapshot cross join jsonb_array_elements(manifest->'items') item where item->>'language' not in ('en','zh-HK') or item->>'language' is null or item->>'market' is null or item->>'market' not in ('HK','TW','SG','JP','KR','US','UK','EU','AU','CA','global')) then 'PULSE_CONTEXT_UNCONFIRMED'
       when not exists(select 1 from pulse_run_reservations z join candidate r on r.id=z.run_id where z.account_id=${scope.accountId})
         and coalesce((select sum(reserved_units) from pulse_run_reservations where account_id=${scope.accountId} and scan_week=${input.scanWeek}::date),0)
           +coalesce((select sum(jsonb_array_length(unreserved.manifest->'items')) from pulse_runs unreserved where unreserved.account_id=${scope.accountId} and unreserved.scan_week=${input.scanWeek}::date and not exists(select 1 from pulse_run_reservations z where z.run_id=unreserved.id and z.account_id=unreserved.account_id) and not exists(select 1 from candidate where candidate.id=unreserved.id)),0)
           +coalesce((select jsonb_array_length(manifest->'items') from candidate),(select jsonb_array_length(manifest->'items') from snapshot))>${input.dispatch?.reservationCap??0} then 'PULSE_QUOTA_EXCEEDED'
       else null end as reason
    ), created as (
      insert into pulse_runs(account_id,client_id,scan_week,manifest,purpose,intent_key,source_run_id)
      select ${scope.accountId},${scope.clientId}::uuid,${input.scanWeek}::date,manifest,${purpose},${input.intent?.intentKey??null},${input.intent?.sourceRunId??null}::uuid from snapshot
      where (select reason from gate) is null and not exists(select 1 from jsonb_array_elements(manifest->'items') item where item->>'language' not in ('en','zh-HK') or item->>'language' is null or item->>'market' is null or item->>'market' not in ('HK','TW','SG','JP','KR','US','UK','EU','AU','CA','global')) and (${purpose}='retest' or not exists(select 1 from pulse_metrics legacy where legacy.client_id=${scope.clientId}::uuid and legacy.scan_week=${input.scanWeek}::date and legacy.run_item_id is null and legacy.raw_answer ~ '[^[:space:]]')) and not exists(select 1 from prior_intent) and ${input.intent?.kind??'initial'}<>'repair' and (${input.intent?.sourceRunId??null}::uuid is null or exists(select 1 from pulse_runs source where source.id=${input.intent?.sourceRunId??null}::uuid and source.account_id=${scope.accountId} and source.client_id=${scope.clientId}::uuid))
      on conflict do nothing returning *
    ), chosen as (
      select id,account_id,client_id,scan_week,manifest,purpose from created
      union all select id,account_id,client_id,scan_week,manifest,purpose from prior_intent where request_hash=${input.dispatch?.requestHash??null}
      union all select id,account_id,client_id,scan_week,manifest,purpose from candidate where not exists(select 1 from prior_intent) and (select reason from gate) is null
    ), items as (
      insert into pulse_run_items(run_id,account_id,client_id,prompt_snapshot_id,snapshot,platform,model_id)
      select r.id,r.account_id,r.client_id,(v->>'promptId')::uuid,
        v - 'promptId' - 'platform' - 'model',v->>'platform',v->>'model'
      from chosen r cross join jsonb_array_elements(r.manifest->'items') v
      on conflict(run_id,prompt_snapshot_id,model_id) do nothing returning id
    ), reserved as (
      insert into pulse_run_reservations(run_id,account_id,client_id,scan_week,reserved_units)
      select id,account_id,client_id,scan_week,jsonb_array_length(manifest->'items') from chosen where ${!!input.dispatch}
      on conflict(run_id) do nothing returning run_id
    ), intent_record as (
      insert into pulse_user_intents(account_id,client_id,intent_key,request_hash,run_id,kind)
      select account_id,client_id,${input.intent?.intentKey??null},${input.dispatch?.requestHash??null},id,${input.intent?.kind??'initial'} from chosen where ${!!input.dispatch}
      on conflict(account_id,client_id,intent_key) do nothing returning run_id
    ) select id,scan_week,manifest,purpose,null::text as reason from chosen
      union all select null::uuid,null::date,null::jsonb,null::text,reason from gate where reason is not null`, 
  ])
  const row = results.at(-1)?.[0]
  if(row?.reason)throw new Error(String(row.reason))
  return row ? { id: String(row.id), scanWeek: isoDate(row.scan_week as string | Date, input.scanWeek), manifest: row.manifest as Record<string, unknown>,purpose:row.purpose as 'canonical'|'retest' } : null
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
    sql`update pulse_run_items set status = 'blocked',lease_token = null,lease_until = null,lease_owner = null,updated_at = now()
      where account_id = ${scope.accountId} and client_id = ${scope.clientId}::uuid and run_id = ${runId}::uuid
        and status = 'running' and lease_until < now()`,
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
        grounding = ${evidence?.grounding ?? null},
        search_evidence = ${evidence?.searchEvidence?JSON.stringify(evidence.searchEvidence):null}::jsonb,
        http_status = ${evidence?.httpStatus ?? (output.kind !== 'succeeded' ? output.httpStatus ?? null : null)},
        error_code = ${output.kind !== 'succeeded' ? output.errorCode.slice(0,80) : null}
      from current i where a.id = ${lease.attemptId}::uuid and a.item_id = i.id and a.lease_token = i.lease_token and a.fence = i.fence
        and a.collection_status = 'started' returning a.id
    ), accepted as (
      update pulse_run_items i set status = case when ${output.kind} = 'succeeded' then 'succeeded'
        when ${output.kind} = 'blocked' or ${output.kind!=='succeeded'?output.errorCode.includes('OUTCOME_UNKNOWN'):false} then 'blocked' when attempt_count >= 3 then 'failed' else 'retry_wait' end,
        next_attempt_at = now() + case attempt_count when 1 then interval '60 seconds' when 2 then interval '300 seconds' else interval '1800 seconds' end,
        accepted_attempt_id = case when ${output.kind} = 'succeeded' then (select id from attempt) else null end,
        lease_token = null,lease_until = null,lease_owner = null,updated_at = now()
      where i.id in (select id from current) and exists(select 1 from attempt) returning i.*
    ), projection as (
      insert into pulse_metrics(client_id,prompt_id,platform,question,raw_answer,scan_week,run_item_id,provider_citations,grounding,search_evidence)
      select i.client_id,(select p.id from prompt_bank p where p.id = i.prompt_snapshot_id and p.client_id = i.client_id),
        i.platform,i.snapshot->>'question',${evidence?.answer ?? null},r.scan_week,i.id,
        ${evidence?.providerCitations == null ? null : JSON.stringify(evidence.providerCitations)}::jsonb,${evidence?.grounding ?? null},${evidence?.searchEvidence?JSON.stringify(evidence.searchEvidence):null}::jsonb
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
