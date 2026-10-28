import 'server-only'
import { randomBytes,randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { sealToken,openToken } from '@/lib/integrations/google/vault'
import { resolveCommercialEntitlement,type CommercialAccount } from '@/lib/tier'
import { isFeatureEnabled } from '@/lib/flags'
import { OutcomeError,UUID } from '@/lib/outcome-integrations/input'
import type { OutcomeScope } from '@/lib/outcome-integrations/store'
import { enterpriseWrite,missing } from './store'
import { parseEnterpriseKey,type EnterpriseScope } from './input'
import { verifyEnterpriseRequest } from './signature'
export async function createEnterpriseKey(scope:OutcomeScope,actor:string,input:ReturnType<typeof parseEnterpriseKey>){
 const sql=db(),id=randomUUID(),secret=randomBytes(32).toString('base64url'),sealed=sealToken(secret,{accountId:scope.accountId,purpose:`enterprise-api:${id}`})
 const rows=await enterpriseWrite(scope,sql`with inserted as(insert into enterprise_keys(id,account_id,client_id,created_by,name,scopes,adapter_id,ciphertext,key_id)
 select ${id}::uuid,c.account_id,c.id,${actor}::uuid,${input.name},${input.scopes}::text[],${input.adapterId}::uuid,decode(${sealed.ciphertext.toString('hex')},'hex'),${sealed.keyId} from clients c
 where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and enterprise_active_member_role(c.account_id,${actor}::uuid)='manager'
 and(select count(*) from enterprise_keys where account_id=c.account_id and client_id=c.id and revoked_at is null)<50
 and(${input.adapterId}::uuid is null or exists(select 1 from enterprise_adapters where account_id=c.account_id and client_id=c.id and id=${input.adapterId}::uuid and revoked_at is null)) returning id),
 logged as(insert into enterprise_audit(account_id,client_id,actor_id,action,target_id,metadata) select ${scope.accountId}::uuid,${scope.clientId}::uuid,${actor}::uuid,'key.created',id,jsonb_build_object('scopes',${input.scopes}::text[]) from inserted returning id) select id from inserted`)
 if(!rows[0])missing();return{id,secret,scopes:input.scopes,adapterId:input.adapterId}
}
export async function authenticateEnterpriseApi(request:Request,clientId:string,scope:EnterpriseScope,body:string){
 if(!isFeatureEnabled('enterprise_os'))missing()
 const id=request.headers.get('x-aiso-key')??'',timestamp=request.headers.get('x-aiso-timestamp')??'',nonce=request.headers.get('x-aiso-nonce')??'',signature=request.headers.get('x-aiso-signature')??''
 if(!UUID.test(id)||!UUID.test(clientId))throw new OutcomeError('UNAUTHENTICATED',401)
 const sql=db();const [key]=await sql`select k.id,k.account_id,k.client_id,k.adapter_id,k.scopes,k.ciphertext,k.key_id,a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at
 from enterprise_keys k join clients c on c.id=k.client_id and c.account_id=k.account_id join accounts a on a.id=k.account_id where k.id=${id}::uuid and k.client_id=${clientId}::uuid and k.revoked_at is null and c.status='active' and enterprise_active_member_role(k.account_id,k.created_by)='manager'`
 if(!key||!resolveCommercialEntitlement(key as CommercialAccount).features.public_api)throw new OutcomeError('UNAUTHENTICATED',401)
 if(!(key.scopes as string[]).includes(scope))throw new OutcomeError('ENTERPRISE_SCOPE_REQUIRED',403)
 if(scope==='adapter:write'&&!resolveCommercialEntitlement(key as CommercialAccount).features.custom_adapters)throw new OutcomeError('UPGRADE_REQUIRED',403)
 const secret=openToken({ciphertext:Buffer.from(key.ciphertext),keyId:String(key.key_id)},{accountId:String(key.account_id),purpose:`enterprise-api:${String(key.id)}`}),url=new URL(request.url)
 if(!verifyEnterpriseRequest(secret,{timestamp,nonce,method:request.method,path:url.pathname+url.search,body},signature))throw new OutcomeError('UNAUTHENTICATED',401)
 return{scope:{accountId:String(key.account_id),clientId:String(key.client_id)},adapterId:key.adapter_id?String(key.adapter_id):null,keyId:id,nonce}
}
export async function consumeEnterpriseApi(access:Awaited<ReturnType<typeof authenticateEnterpriseApi>>,scope:EnterpriseScope){
 const sql=db();const [r]=await sql`select enterprise_consume_request(${access.scope.accountId}::uuid,${access.scope.clientId}::uuid,${access.keyId}::uuid,${access.nonce}::uuid,${scope}) as result`
 if(r?.result!=='OK')throw new OutcomeError(r?.result==='REPLAY'?'ENTERPRISE_REPLAY':r?.result==='RATE_LIMITED'?'ENTERPRISE_RATE_LIMITED':'UNAUTHENTICATED',r?.result==='REPLAY'?409:r?.result==='RATE_LIMITED'?429:401)
}
