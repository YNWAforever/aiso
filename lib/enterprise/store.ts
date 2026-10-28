import 'server-only'
import { randomBytes,randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { OutcomeError } from '@/lib/outcome-integrations/input'
import type { OutcomeScope } from '@/lib/outcome-integrations/store'
import { parsePortalConfig,type EnterpriseRole } from './input'
import { signPortalLink } from './signature'
import { buildExecutiveSnapshot,type PortalConfig } from './reports'
export const missing=():never=>{throw new OutcomeError('ENTERPRISE_NOT_FOUND',404)}
export const conflict=():never=>{throw new OutcomeError('ENTERPRISE_CONFLICT',409)}
type Pending=ReturnType<ReturnType<typeof db>>
export async function enterpriseWrite(scope:OutcomeScope,query:Pending){const sql=db();const results=await sql.transaction([sql`select id from accounts where id=${scope.accountId}::uuid for update`,query],{isolationLevel:'ReadCommitted'});return results.at(-1)!}
export async function readEnterpriseBranding(scope:OutcomeScope,locale:'en'|'zh-HK'='en'){
 const sql=db();const [row]=await sql`select b.configuration,c.brand_name from clients c left join enterprise_branding b on b.account_id=c.account_id and b.client_id=c.id where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid`
 if(!row)missing();return row.configuration?parsePortalConfig(row.configuration):{name:String(row.brand_name),companyName:String(row.brand_name),primaryColor:'#1D4ED8',logoUrl:null,locale}
}
export async function saveEnterpriseBranding(scope:OutcomeScope,actor:string,input:PortalConfig){const sql=db();const rows=await enterpriseWrite(scope,sql`with saved as(insert into enterprise_branding(account_id,client_id,configuration,updated_by)
 select c.account_id,c.id,${JSON.stringify(input)}::jsonb,${actor}::uuid from clients c where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and enterprise_active_member_role(c.account_id,${actor}::uuid)='manager'
 on conflict(account_id,client_id) do update set configuration=excluded.configuration,updated_by=excluded.updated_by,updated_at=now() returning client_id)
 insert into enterprise_audit(account_id,client_id,actor_id,action,target_id) select ${scope.accountId}::uuid,client_id,${actor}::uuid,'branding.updated',client_id from saved returning id`);if(!rows.length)missing();return{saved:true}}
export async function saveEnterpriseArtifact(scope:OutcomeScope,actor:string,kind:'executive_report'|'schedule'|'visibility_draft',payload:unknown,sourceId:string|null=null,author=actor){
 const sql=db(),id=randomUUID(),minimum=kind==='schedule'?'manager':'editor'
 const rows=await enterpriseWrite(scope,sql`with inserted as(insert into enterprise_artifacts(id,account_id,client_id,kind,source_id,created_by,submitted_by,payload)
 select ${id}::uuid,c.account_id,c.id,${kind},${sourceId}::uuid,${author}::uuid,${actor}::uuid,${JSON.stringify(payload)}::jsonb from clients c
 where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and enterprise_active_member_role(c.account_id,${actor}::uuid)=any(${minimum==='manager'?['manager']:['editor','manager']}::text[])
 and (${kind}<>'schedule' or not exists(select 1 from jsonb_array_elements_text(${JSON.stringify(payload)}::jsonb->'recipientIds') requested(id) where not exists(select 1 from profiles where id=requested.id::uuid and account_id=c.account_id and deactivated_at is null)))
 and exists(select 1 from profiles where id=${author}::uuid and account_id=c.account_id and deactivated_at is null) returning *),
 scheduled as(insert into enterprise_schedules(account_id,client_id,artifact_id,created_by) select account_id,client_id,id,created_by from inserted where kind='schedule' returning id),
 logged as(insert into enterprise_audit(account_id,client_id,actor_id,action,target_id,metadata) select account_id,client_id,${actor}::uuid,'artifact.submitted',id,jsonb_build_object('kind',kind,'contentHash',content_hash) from inserted returning id)
 select id,kind,content_hash,payload,created_at from inserted`)
 if(!rows[0])missing();return rows[0]
}
export async function createExecutiveReport(scope:OutcomeScope,actor:string,window:{start:string;end:string},lang:'en'|'zh-HK'){
 const branding=await readEnterpriseBranding(scope,lang),snapshot=await buildExecutiveSnapshot(scope,window,{...branding,locale:lang});if(!snapshot)missing()
 return saveEnterpriseArtifact(scope,actor,'executive_report',snapshot)
}
export async function decideEnterpriseArtifact(scope:OutcomeScope,actor:string,input:{artifactId:string;decision:string;reason:string;requestId:string}){
 const sql=db();const [row]=await sql`select enterprise_decide(${scope.accountId}::uuid,${scope.clientId}::uuid,${input.artifactId}::uuid,${actor}::uuid,${input.decision},${input.reason},${input.requestId}::uuid) as result`
 if(row?.result==='DENIED')throw new OutcomeError('ENTERPRISE_FORBIDDEN',403);if(row?.result==='NOT_FOUND')missing();if(!['CREATED','REPLAYED'].includes(String(row?.result)))conflict()
 return{status:String(row.result).toLowerCase()}
}
export async function publishEnterprisePortal(scope:OutcomeScope,actor:string,artifactId:string){
 const sql=db(),slug=randomBytes(24).toString('base64url')
 // Signing configuration must be valid before a publication record is written.
 signPortalLink({slug,version:1,locale:'en'})
 const [row]=await sql`select p.*,a.payload->>'locale' as locale from enterprise_publish_portal(${scope.accountId}::uuid,${scope.clientId}::uuid,${artifactId}::uuid,${actor}::uuid,${slug}) p join enterprise_artifacts a on a.id=p.artifact_id and a.account_id=p.account_id and a.client_id=p.client_id`
 if(!row)throw new OutcomeError('ENTERPRISE_APPROVAL_REQUIRED',409)
 return portalLink(row)
}
export function portalLink(row:Record<string,unknown>){const locale:'en'|'zh-HK'=row.locale==='zh-HK'?'zh-HK':'en',link={slug:String(row.slug),version:Number(row.version),locale};return{id:String(row.id),path:`/${locale}/portal/${link.slug}?v=${link.version}&sig=${signPortalLink(link)}`}}
export async function revokeEnterpriseResource(scope:OutcomeScope,actor:string,kind:'portal'|'key'|'webhook'|'adapter'|'schedule',id:string){
 const sql=db();const[row]=await sql`select enterprise_revoke_resource(${scope.accountId}::uuid,${scope.clientId}::uuid,${actor}::uuid,${kind},${id}::uuid) as result`
 if(row?.result==='DENIED')throw new OutcomeError('ENTERPRISE_FORBIDDEN',403)
 if(!['CREATED','REPLAYED'].includes(String(row?.result)))missing()
 return{revoked:true}
}
export async function loadEnterpriseWorkspace(scope:OutcomeScope,actor:string,role:EnterpriseRole,platformAdmin=false){
 const sql=db();const [artifacts,portals,schedules,keys,webhooks,adapters,runs,deliveries,periods,audit,members,grant,queries,visibilityDrafts,backlog]=await Promise.all([
  sql`select a.id,a.kind,a.source_id,a.payload,a.content_hash,a.created_by,a.submitted_by,a.created_at,d.decision,d.actor_id as reviewer,d.reason as review_reason from enterprise_artifacts a left join enterprise_decisions d on d.account_id=a.account_id and d.client_id=a.client_id and d.artifact_id=a.id and d.content_hash=a.content_hash where a.account_id=${scope.accountId}::uuid and a.client_id=${scope.clientId}::uuid order by a.created_at desc,a.id desc limit 20`,
  sql`select p.id,p.slug,p.version,p.artifact_id,p.revoked_at,a.payload->>'locale' as locale from enterprise_portals p join enterprise_artifacts a on a.id=p.artifact_id and a.account_id=p.account_id and a.client_id=p.client_id where p.account_id=${scope.accountId}::uuid and p.client_id=${scope.clientId}::uuid order by p.published_at desc limit 20`,
  sql`select s.id,s.artifact_id,s.enabled,s.approved_at,a.payload from enterprise_schedules s join enterprise_artifacts a on a.id=s.artifact_id and a.account_id=s.account_id and a.client_id=s.client_id where s.account_id=${scope.accountId}::uuid and s.client_id=${scope.clientId}::uuid order by s.created_at desc limit 20`,
  role==='manager'?sql`select id,name,scopes,adapter_id,created_at,revoked_at from enterprise_keys where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by created_at desc limit 50`:Promise.resolve([]),
  role==='manager'?sql`select id,name,target_origin,events,created_at,revoked_at from enterprise_webhooks where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by created_at desc limit 20`:Promise.resolve([]),
  sql`select id,name,model,temperature,version,revoked_at from enterprise_adapters where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by created_at desc limit 20`,
  sql`select r.id,r.adapter_id,r.manifest,r.created_at,(select count(*)::int from enterprise_adapter_observations o where o.account_id=r.account_id and o.client_id=r.client_id and o.run_id=r.id) as results from enterprise_adapter_runs r where r.account_id=${scope.accountId}::uuid and r.client_id=${scope.clientId}::uuid order by r.created_at desc limit 10`,
  sql`select id,kind,status,attempt_count,reason,event_id,created_at from enterprise_deliveries where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by created_at desc limit 30`,
  sql`select id,schedule_id,period_start,period_end,status,reason,attempt_count,artifact_id,result from enterprise_schedule_periods where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by created_at desc limit 30`,
  sql`select id,action,target_id,actor_id,metadata,created_at from enterprise_audit where account_id=${scope.accountId}::uuid and (client_id=${scope.clientId}::uuid or client_id is null) order by created_at desc,id desc limit 50`,
  role==='manager'||platformAdmin?sql`select p.id,p.display_name,enterprise_active_member_role(p.account_id,p.id) as role,coalesce(r.revision,0) as revision from profiles p left join enterprise_roles r on r.profile_id=p.id and r.account_id=p.account_id where p.account_id=${scope.accountId}::uuid and p.deactivated_at is null order by p.id limit 100`:Promise.resolve([]),
  sql`select s.profile_id from account_approver_state s join account_approver_events e on e.id=s.last_event_id and e.account_id=s.account_id and e.profile_id=s.profile_id and e.new_revision=s.revision and e.action='grant' where s.account_id=${scope.accountId}::uuid and s.profile_id=${actor}::uuid and s.active is true and enterprise_active_member_role(s.account_id,s.profile_id) is not null`,
  sql`select p.id,p.question,p.language,p.market from prompt_bank p join clients c on c.id=p.client_id where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and p.is_active and p.monitoring is not null order by p.id limit 100`,
  sql`select id,kind,locale,created_at from visibility_drafts where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by created_at desc,id desc limit 20`,
  sql`select (select count(*)::int from enterprise_deliveries where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and status in('queued','running','unknown')) as deliveries,(select count(*)::int from enterprise_schedule_periods where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and status in('queued','running','failed','unknown')) as reports`,
 ])
 return{backlog:backlog[0]??{deliveries:0,reports:0},queries,visibilityDrafts,role,actorId:actor,canApprove:!!grant.length,branding:await readEnterpriseBranding(scope),artifacts,portals:portals.map(row=>({id:String(row.id),artifactId:String(row.artifact_id),revoked_at:row.revoked_at?String(row.revoked_at):null,...(row.revoked_at?{}:portalLink(row))})),schedules,keys,webhooks,adapters,runs,deliveries,periods,audit,members,coverage:{artifacts:20,runs:10,deliveries:30,audit:50}}
}

export async function readEnterpriseArtifact(scope:OutcomeScope,id:string){try{const sql=db();const[row]=await sql`select a.id,a.kind,a.payload,a.content_hash,a.created_at,d.decision from enterprise_artifacts a left join enterprise_decisions d on d.artifact_id=a.id and d.account_id=a.account_id and d.client_id=a.client_id and d.content_hash=a.content_hash where a.account_id=${scope.accountId}::uuid and a.client_id=${scope.clientId}::uuid and a.id=${id}::uuid`;return row??null}catch{throw new OutcomeError('ENTERPRISE_UNAVAILABLE',503)}}
