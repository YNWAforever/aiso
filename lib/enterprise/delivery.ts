import 'server-only'
import { randomBytes,randomUUID,createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { createPublicUrlFetcher,type PublicUrlFetch,PublicUrlError } from '@/lib/security/public-url'
import { sealToken,openToken } from '@/lib/integrations/google/vault'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement,type CommercialAccount } from '@/lib/tier'
import { appOrigin } from '@/lib/app-origin'
import { object,text,OutcomeError } from '@/lib/outcome-integrations/input'
import type { OutcomeScope } from '@/lib/outcome-integrations/store'
import { publicHttpsUrl } from './input'
import { signEnterpriseWebhook } from './signature'
import { enterpriseWrite,missing,conflict } from './store'
export const WEBHOOK_EVENTS=['executive_report.ready','workflow.decided','adapter.observation'] as const
const safeFetch=createPublicUrlFetcher({allowedProtocols:['https:'],maxRedirects:0,maxResponseBytes:4096,timeoutMs:5000})
export async function createEnterpriseWebhook(scope:OutcomeScope,actor:string,raw:unknown){
 const input=object(raw,['name','url','events']),name=text(input.name,100),url=publicHttpsUrl(input.url)
 if(!Array.isArray(input.events)||!input.events.length||input.events.length>3||input.events.some(e=>!WEBHOOK_EVENTS.includes(e)))throw new OutcomeError('INVALID_ENTERPRISE_INPUT')
 const events=[...new Set(input.events)] as string[],id=randomUUID(),secret=randomBytes(32).toString('base64url'),seal=(value:string,purpose:string)=>sealToken(value,{accountId:scope.accountId,purpose:`enterprise-webhook-${purpose}:${id}`}),endpoint=seal(url,'url'),signing=seal(secret,'secret'),sql=db()
 const rows=await enterpriseWrite(scope,sql`with inserted as(insert into enterprise_webhooks(id,account_id,client_id,created_by,name,target_origin,url_ciphertext,url_key_id,secret_ciphertext,secret_key_id,events)
 select ${id}::uuid,c.account_id,c.id,${actor}::uuid,${name},${new URL(url).origin},decode(${endpoint.ciphertext.toString('hex')},'hex'),${endpoint.keyId},decode(${signing.ciphertext.toString('hex')},'hex'),${signing.keyId},${events}::text[]
 from clients c where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and enterprise_active_member_role(c.account_id,${actor}::uuid)='manager'
 and(select count(*) from enterprise_webhooks where account_id=c.account_id and client_id=c.id and revoked_at is null)<20 returning id),
 logged as(insert into enterprise_audit(account_id,client_id,actor_id,action,target_id,metadata) select ${scope.accountId}::uuid,${scope.clientId}::uuid,${actor}::uuid,'webhook.created',id,jsonb_build_object('origin',${new URL(url).origin}::text) from inserted returning id) select id from inserted`)
 if(!rows[0])missing();return{id,secret,name,targetOrigin:new URL(url).origin,events}
}
export type EnterpriseJob={id:string;accountId:string;clientId:string;kind:'email'|'webhook';token:string;attempt:number;createdAt:string;firstSentAt?:string|null}
type Event={id:string;version:string;type:string;occurredAt:string;data:Record<string,unknown>}
type Target={allowed:false}|{allowed:true;kind:'webhook';url:string;secret:string;event:Event}|{allowed:true;kind:'email';to:string;locale:string;artifactId:string;event:Event}
export async function authorizeEnterpriseDelivery(job:EnterpriseJob):Promise<Target>{
 if(!isFeatureEnabled('enterprise_os'))return{allowed:false}
 const sql=db();const[row]=await sql`select d.*,e.type,e.payload,e.created_at as event_at,a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at,
 w.id as endpoint_active,w.url_ciphertext,w.url_key_id,w.secret_ciphertext,w.secret_key_id,w.created_by as webhook_actor,w.revoked_at,
 p.id as recipient_active,u.email as recipient_email,c.status as client_status
 from enterprise_deliveries d join enterprise_events e on e.id=d.event_id and e.account_id=d.account_id and e.client_id=d.client_id
 join clients c on c.id=d.client_id and c.account_id=d.account_id join accounts a on a.id=d.account_id
 left join enterprise_webhooks w on w.id=d.endpoint_id and w.account_id=d.account_id and w.client_id=d.client_id and w.revoked_at is null
 left join profiles p on p.id=d.recipient_id and p.account_id=d.account_id and p.deactivated_at is null left join neon_auth."user" u on u.id=p.id
 where d.id=${job.id}::uuid and d.account_id=${job.accountId}::uuid and d.client_id=${job.clientId}::uuid and d.status='running' and d.lease_token=${job.token}::uuid and d.lease_until>clock_timestamp()`
 if(!row||row.client_status!=='active')return{allowed:false}
 const entitlement=resolveCommercialEntitlement(row as CommercialAccount),event:Event={id:String(row.event_id),version:'v1',type:String(row.type),occurredAt:new Date(String(row.event_at)).toISOString(),data:row.payload as Record<string,unknown>}
 if(job.kind==='webhook'){
  const [actor]=row.webhook_actor?await sql`select enterprise_active_member_role(${job.accountId}::uuid,${String(row.webhook_actor)}::uuid) as role`:[]
  if(!entitlement.features.webhooks||!row.endpoint_active||actor?.role!=='manager')return{allowed:false}
  const open=(value:unknown,keyId:unknown,purpose:string)=>openToken({ciphertext:Buffer.from(value as Uint8Array),keyId:String(keyId)},{accountId:job.accountId,purpose:`enterprise-webhook-${purpose}:${row.endpoint_id}`})
  return{allowed:true,kind:'webhook',url:open(row.url_ciphertext,row.url_key_id,'url'),secret:open(row.secret_ciphertext,row.secret_key_id,'secret'),event}
 }
 const issuer=event.data.issuerId,[actor]=typeof issuer==='string'?await sql`select enterprise_active_member_role(${job.accountId}::uuid,${issuer}::uuid) as role`:[]
 if(!entitlement.features.scheduled_reports||actor?.role!=='manager'||!row.recipient_active||typeof row.recipient_email!=='string'||!/^\S+@\S+\.\S+$/.test(row.recipient_email)||/[\r\n]/.test(row.recipient_email))return{allowed:false}
 return{allowed:true,kind:'email',to:row.recipient_email,locale:event.data.locale==='zh-HK'?'zh-HK':'en',artifactId:String(event.data.artifactId),event}
}
export async function claimEnterpriseDelivery(scope:OutcomeScope,id:string):Promise<EnterpriseJob|null>{
 const sql=db(),token=randomUUID(),rows=await enterpriseWrite(scope,sql`with claimed as(update enterprise_deliveries set status='running',attempt_count=attempt_count+1,lease_token=${token}::uuid,lease_until=clock_timestamp()+interval '2 minutes'
 where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and id=${id}::uuid and status='queued' and next_at<=clock_timestamp() and attempt_count<3 returning *),
 attempt as(insert into enterprise_attempts(account_id,client_id,job_id,job_kind,number,lease_token) select account_id,client_id,id,'delivery',attempt_count,lease_token from claimed returning id)
 select id,kind,attempt_count,created_at,first_sent_at from claimed`)
 const row=rows[0];return row?{id:String(row.id),...scope,kind:row.kind as 'email'|'webhook',token,attempt:Number(row.attempt_count),createdAt:new Date(String(row.created_at)).toISOString(),firstSentAt:row.first_sent_at?new Date(String(row.first_sent_at)).toISOString():null}:null
}
export async function finishEnterpriseDelivery(job:EnterpriseJob,status:'succeeded'|'failed'|'blocked'|'unknown',reason:string,httpStatus:number|null){
 const sql=db(),rows=await enterpriseWrite(job,sql`with finished as(update enterprise_deliveries set status=${status},reason=${reason},finished_at=clock_timestamp(),lease_until=null
 where account_id=${job.accountId}::uuid and client_id=${job.clientId}::uuid and id=${job.id}::uuid and status='running' and lease_token=${job.token}::uuid and lease_until>clock_timestamp() returning id),
 attempt as(update enterprise_attempts set status=${status},reason=${reason},http_status=${httpStatus},finished_at=clock_timestamp()
 where account_id=${job.accountId}::uuid and client_id=${job.clientId}::uuid and job_id=${job.id}::uuid and job_kind='delivery' and lease_token=${job.token}::uuid and status='started' and exists(select 1 from finished) returning id)
 select id from attempt`);return!!rows[0]
}
export async function retryEnterpriseDelivery(scope:OutcomeScope,actor:string,id:string){
 const sql=db(),rows=await enterpriseWrite(scope,sql`with changed as(update enterprise_deliveries set status='queued',next_at=clock_timestamp(),lease_token=null,lease_until=null
 where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and id=${id}::uuid and status in('failed','unknown','blocked') and attempt_count<3
 and (kind='webhook' or first_sent_at is null or first_sent_at>clock_timestamp()-interval '23 hours') and enterprise_active_member_role(account_id,${actor}::uuid)='manager' returning id),
 logged as(insert into enterprise_audit(account_id,client_id,actor_id,action,target_id) select ${scope.accountId}::uuid,${scope.clientId}::uuid,${actor}::uuid,'delivery.retried',id from changed returning id) select * from changed`)
 if(!rows[0])conflict();return{queued:true}
}
export async function retainEnterpriseRequest(job:EnterpriseJob,hash:string){const sql=db();const rows=await enterpriseWrite(job,sql`update enterprise_deliveries set request_hash=${hash},first_sent_at=coalesce(first_sent_at,clock_timestamp()) where account_id=${job.accountId}::uuid and client_id=${job.clientId}::uuid and id=${job.id}::uuid and status='running' and lease_token=${job.token}::uuid and lease_until>clock_timestamp() and(request_hash is null or request_hash=${hash}) returning id`);return!!rows.length}
type Ports={retain?:typeof retainEnterpriseRequest;authorize:(job:EnterpriseJob)=>Promise<Target>;send:PublicUrlFetch;finish:typeof finishEnterpriseDelivery}
const defaults:Ports={authorize:authorizeEnterpriseDelivery,send:safeFetch,finish:finishEnterpriseDelivery,retain:retainEnterpriseRequest}
export async function deliverEnterpriseJob(job:EnterpriseJob,deadline:number,deps:Ports=defaults){
 async function finish(status:Parameters<Ports['finish']>[1],reason:string,code:number|null=null){if(!await deps.finish(job,status,reason,code))throw new OutcomeError('ENTERPRISE_LEASE_LOST',409);return{status,reason}}
 let target:Target;try{target=await deps.authorize(job)}catch{return finish('blocked','DELIVERY_CONFIGURATION_UNAVAILABLE')}
 if(!target.allowed)return finish('blocked','AUTHORIZATION_CHANGED')
 if(Date.now()+6000>=deadline)return finish('failed','TIME_BUDGET_EXHAUSTED')
 if(target.kind==='email'&&job.firstSentAt&&Date.now()-Date.parse(job.firstSentAt)>23*3600000)return finish('unknown','IDEMPOTENCY_WINDOW_EXPIRED')
 let url:string,headers:Record<string,string>,body:string
 if(target.kind==='webhook'){
  url=target.url;body=JSON.stringify(target.event);const timestamp=String(Math.floor(Date.now()/1000));headers={'Content-Type':'application/json','X-AISO-Event-ID':target.event.id,'X-AISO-Timestamp':timestamp,'X-AISO-Signature':signEnterpriseWebhook(target.secret,timestamp,body)}
 }else{
  if(!process.env.RESEND_API_KEY)return finish('blocked','EMAIL_NOT_CONFIGURED')
  const lang=target.locale==='zh-HK'?'zh-HK':'en',link=`${appOrigin()}/${lang}/dashboard/${job.clientId}/enterprise?report=${target.artifactId}`
  url='https://api.resend.com/emails';headers={'Content-Type':'application/json',Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Idempotency-Key':`aiso-executive-v1:${job.id}`}
  body=JSON.stringify({from:process.env.RESEND_FROM_EMAIL?.trim()||'alerts@fimmick-aeo.com',to:[target.to],subject:lang==='zh-HK'?'行政報告已準備就緒':'Your executive report is ready',text:lang==='zh-HK'?`私人報告已準備就緒。請登入工作區查看：\n${link}`:`Your private report is ready. Sign in to your workspace to review:\n${link}`})
 }
 if(Buffer.byteLength(body)>32768)return finish('blocked','DELIVERY_BODY_TOO_LARGE')
 try{if(deps.retain&&!await deps.retain(job,createHash('sha256').update(body).digest('hex')))return finish('blocked','DELIVERY_REQUEST_CHANGED')}catch{return finish('failed','DELIVERY_REQUEST_RECORD_UNAVAILABLE')}
 let response:Response
 try{response=await deps.send(url,{method:'POST',headers,body,redirect:'error'});await response.body?.cancel().catch(()=>{})}
 catch(error){return finish(error instanceof PublicUrlError&&error.code==='UNSAFE_URL'?'blocked':'unknown',error instanceof PublicUrlError&&error.code==='UNSAFE_URL'?'UNSAFE_DESTINATION':'DELIVERY_UNCONFIRMED')}
 return finish(response.ok?'succeeded':response.status>=400&&response.status<500&&response.status!==429?'blocked':'failed',response.ok?'ACCEPTED':'PROVIDER_REFUSED',response.status)
}
