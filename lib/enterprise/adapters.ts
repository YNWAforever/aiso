import 'server-only'
import { db } from '@/lib/db'
import { outcomeHash,type OutcomeScope } from '@/lib/outcome-integrations/store'
import { normalizeBrandDomain } from '@/lib/integrations/search-console/binding'
import { visibilityGroundingKey } from '@/lib/visibility/grounding'
import { projectVisibilityObservation } from '@/lib/visibility/report'
import { buildMarketBenchmarks,type BenchmarkObservation } from './benchmarks'
import { enterpriseWrite,missing,conflict } from './store'
import { parseAdapterConfig,parseAdapterObservation } from './input'
export async function createEnterpriseAdapter(scope:OutcomeScope,actor:string,input:ReturnType<typeof parseAdapterConfig>){
 const sql=db();const rows=await enterpriseWrite(scope,sql`with inserted as(insert into enterprise_adapters(account_id,client_id,created_by,name,model,temperature)
 select c.account_id,c.id,${actor}::uuid,${input.name},${input.model},${input.temperature} from clients c where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and enterprise_active_member_role(c.account_id,${actor}::uuid)='manager'
 and(select count(*) from enterprise_adapters where account_id=c.account_id and client_id=c.id and revoked_at is null)<20 returning id,name,model,temperature),
 logged as(insert into enterprise_audit(account_id,client_id,actor_id,action,target_id) select ${scope.accountId}::uuid,${scope.clientId}::uuid,${actor}::uuid,'adapter.created',id from inserted returning id) select * from inserted`)
 if(!rows[0])missing();return rows[0]
}
export async function createAdapterRun(scope:OutcomeScope,actor:string,adapterId:string,promptIds:string[]){
 const sql=db();const rows=await enterpriseWrite(scope,sql`with context as(select k.*,c.domain from enterprise_adapters k join clients c on c.id=k.client_id and c.account_id=k.account_id where k.account_id=${scope.accountId}::uuid and k.client_id=${scope.clientId}::uuid and k.id=${adapterId}::uuid and k.revoked_at is null
 and enterprise_active_member_role(k.account_id,${actor}::uuid)=any(array['editor','manager'])),queries as(select p.id,p.question,p.language,p.market,p.monitoring from prompt_bank p join clients c on c.id=p.client_id
 where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and p.id=any(${promptIds}::uuid[]) and p.is_active and p.monitoring is not null and p.monitoring->>'locale'=p.language and p.monitoring->>'market'=p.market),
 inserted as(insert into enterprise_adapter_runs(account_id,client_id,adapter_id,created_by,manifest)
 select k.account_id,k.client_id,k.id,${actor}::uuid,jsonb_build_object('version','connector.v1','provenance','connector_reported','domain',k.domain,'model',k.model,'sampling',jsonb_build_object('temperature',k.temperature,'samplesPerRun',1,'seed',null),
 'items',(select jsonb_agg(jsonb_build_object('promptId',q.id,'question',q.question,'locale',q.language,'market',q.market,'context',q.monitoring) order by q.id) from queries q))
 from context k where (select count(*) from queries)=${promptIds.length} and ${promptIds.length} between 1 and 50 returning id,adapter_id,manifest,created_at),
 logged as(insert into enterprise_audit(account_id,client_id,actor_id,action,target_id) select ${scope.accountId}::uuid,${scope.clientId}::uuid,${actor}::uuid,'adapter.run_created',id from inserted returning id) select * from inserted`)
 if(!rows[0])missing();return rows[0]
}
export async function ingestAdapterObservation(scope:OutcomeScope,adapterId:string,input:ReturnType<typeof parseAdapterObservation>){
 const sql=db(),hash=outcomeHash(input)
 const rows=await enterpriseWrite(scope,sql`with eligible as(select r.id from enterprise_adapter_runs r join enterprise_adapters a on a.id=r.adapter_id and a.account_id=r.account_id and a.client_id=r.client_id
 where r.account_id=${scope.accountId}::uuid and r.client_id=${scope.clientId}::uuid and r.adapter_id=${adapterId}::uuid and r.id=${input.runId}::uuid and a.revoked_at is null
 and enterprise_active_member_role(r.account_id,a.created_by)='manager' and enterprise_active_member_role(r.account_id,r.created_by)=any(array['editor','manager'])
 and r.created_at<=${input.observedAt}::timestamptz and r.created_at>clock_timestamp()-interval '30 days' and r.manifest->>'model'=${input.actualModel}
 and exists(select 1 from jsonb_array_elements(r.manifest->'items') item where item->>'promptId'=${input.promptId})),
 prior as(select * from enterprise_adapter_observations where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and(event_id=${input.eventId}::uuid or(run_id=${input.runId}::uuid and prompt_id=${input.promptId}::uuid))),
 inserted as(insert into enterprise_adapter_observations(account_id,client_id,adapter_id,run_id,prompt_id,event_id,payload_hash,observed_at,actual_model,answer,citations)
 select ${scope.accountId}::uuid,${scope.clientId}::uuid,${adapterId}::uuid,id,${input.promptId}::uuid,${input.eventId}::uuid,${hash},${input.observedAt}::timestamptz,${input.actualModel},${input.answer},${input.citations===null?null:JSON.stringify(input.citations)}::jsonb from eligible where not exists(select 1 from prior) returning id),
 logged as(insert into enterprise_audit(account_id,client_id,action,target_id,metadata) select ${scope.accountId}::uuid,${scope.clientId}::uuid,'adapter.observed',id,jsonb_build_object('runId',${input.runId}::uuid,'provenance','connector_reported') from inserted returning id)
 select case when not exists(select 1 from eligible) then 'NOT_FOUND' when exists(select 1 from inserted) then 'CREATED'
 when exists(select 1 from prior where payload_hash=${hash} and event_id=${input.eventId}::uuid) then 'REPLAYED' else 'CONFLICT' end as result,
 coalesce((select id from inserted),(select id from prior limit 1)) as id`)
 const row=rows[0];if(!row||row.result==='NOT_FOUND')missing();if(row.result==='CONFLICT')conflict();return{id:String(row.id),status:String(row.result).toLowerCase(),provenance:'connector_reported'}
}
export async function readAdapterRuns(scope:OutcomeScope,adapterId:string){const sql=db();return sql`select r.id,r.adapter_id,r.manifest,r.created_at from enterprise_adapter_runs r join enterprise_adapters a on a.id=r.adapter_id and a.account_id=r.account_id and a.client_id=r.client_id where r.account_id=${scope.accountId}::uuid and r.client_id=${scope.clientId}::uuid and r.adapter_id=${adapterId}::uuid and a.revoked_at is null order by r.created_at desc,r.id desc limit 10`}
export async function readMarketBenchmarks(scope:OutcomeScope){
 const sql=db();const [direct,connector]=await Promise.all([
  sql`select * from ai_observations where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and finished_at>=clock_timestamp()-interval '90 days' order by finished_at desc,id desc limit 500`,
  sql`select o.*,r.manifest from enterprise_adapter_observations o join enterprise_adapter_runs r on r.id=o.run_id and r.account_id=o.account_id and r.client_id=o.client_id and r.adapter_id=o.adapter_id where o.account_id=${scope.accountId}::uuid and o.client_id=${scope.clientId}::uuid and o.observed_at>=clock_timestamp()-interval '90 days' order by o.observed_at desc,o.id desc limit 500`,
 ])
 const rows:BenchmarkObservation[]=direct.map(raw=>{const brand=raw.brand as {domain?:string}|null,p=projectVisibilityObservation(raw,{domain:normalizeBrandDomain(brand?.domain??'')??'',competitors:[]}),{sampling,market:_market,locale:_locale,promptId:_prompt,...context}=p.monitoring
  void _market;void _locale;void _prompt;return{question:p.question,locale:p.locale,market:p.market,model:p.model,sampling,context,grounding:visibilityGroundingKey(p),provenance:visibilityGroundingKey(p)?'accepted-provider-ledger':null,citations:p.citationsRecorded?p.citations.map(c=>c.url):null,domain:normalizeBrandDomain(brand?.domain??'')??'',observedAt:p.observedAt}})
 for(const row of connector){const m=row.manifest as {domain:string;sampling:unknown;items:{promptId:string;question:string;locale:string;market:string;context:Record<string,unknown>}[]},item=m.items.find(i=>i.promptId===row.prompt_id);if(!item)continue
  const {market:_market,locale:_locale,promptId:_prompt,sampling:_sampling,...context}=item.context;void _market;void _locale;void _prompt;void _sampling
  rows.push({question:item.question,locale:item.locale,market:item.market,model:String(row.actual_model),sampling:m.sampling,context,provenance:'connector_reported',citations:(row.citations as {url:string}[]|null)?.map(c=>c.url)??null,domain:normalizeBrandDomain(m.domain)??'',observedAt:row.observed_at instanceof Date?row.observed_at.toISOString():String(row.observed_at)})}
 const report=buildMarketBenchmarks(rows);return{...report,coverage:{windowDays:90,directLimit:500,connectorLimit:500,limitReached:direct.length===500||connector.length===500}}
}
