import 'server-only'
import { db } from '@/lib/db'
import { getProfile } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { OutcomeError } from '@/lib/outcome-integrations/input'
import { readOutcomeJson } from '@/lib/outcome-integrations/request'
import { parseEnterpriseRole } from './input'
import { enterpriseErrorResponse,enterpriseHeaders } from './guard'

export async function setEnterpriseRole(accountId:string,actorId:string,input:ReturnType<typeof parseEnterpriseRole>){
 const sql=db()
 const[row]=await sql`select enterprise_set_role(${accountId}::uuid,${actorId}::uuid,${input.profileId}::uuid,${input.role},${input.expectedRevision},${input.requestId}::uuid,${input.reason}) as result`
 const result=String(row?.result??'')
 if(result==='CREATED'||result==='REPLAYED')return{status:result}
 if(result==='DENIED')throw new OutcomeError('ENTERPRISE_FORBIDDEN',403)
 if(result==='SELF_ROLE_CHANGE_DENIED')throw new OutcomeError('ENTERPRISE_SELF_ROLE_CHANGE_DENIED',403)
 if(result==='ENTITLEMENT_REQUIRED')throw new OutcomeError('UPGRADE_REQUIRED',403)
 if(result==='NOT_FOUND')throw new OutcomeError('ENTERPRISE_NOT_FOUND',404)
 if(result==='INVALID')throw new OutcomeError('INVALID_ENTERPRISE_INPUT')
 if(result==='CONFLICT')throw new OutcomeError('ENTERPRISE_CONFLICT',409)
 throw new OutcomeError('ENTERPRISE_UNAVAILABLE',503)
}

/** The account and actor come from the session; this API accepts no account selector. */
export async function mutateAccountEnterpriseRole(request:Request):Promise<Response>{
 try{
  if(!isFeatureEnabled('enterprise_os'))throw new OutcomeError('ENTERPRISE_NOT_FOUND',404)
  const profile=await getProfile()
  if(!profile)throw new OutcomeError('UNAUTHENTICATED',401)
  if(!resolveCommercialEntitlement(profile.accounts).features.enterprise_workflows)throw new OutcomeError('UPGRADE_REQUIRED',403)
  const sql=db()
  const[access]=await sql`select enterprise_can_manage_roles(${profile.account_id}::uuid,${profile.id}::uuid) as allowed`
  if(access?.allowed!==true)throw new OutcomeError('ENTERPRISE_FORBIDDEN',403)
  if(new URL(request.url).searchParams.size)throw new OutcomeError('INVALID_ENTERPRISE_INPUT')
  const input=parseEnterpriseRole(await readOutcomeJson(request))
  // SQL rechecks active membership, entitlement and grant lineage after locks.
  const result=await setEnterpriseRole(profile.account_id,profile.id,input)
  return Response.json(result,{headers:enterpriseHeaders})
 }catch(error){return enterpriseErrorResponse(error)}
}
