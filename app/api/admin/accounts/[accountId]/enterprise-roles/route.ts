import { requireApiAdmin } from '@/lib/admin-guard'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { uuid,OutcomeError } from '@/lib/outcome-integrations/input'
import { readOutcomeJson } from '@/lib/outcome-integrations/request'
import { parseEnterpriseRole } from '@/lib/enterprise/input'
import { enterpriseErrorResponse,enterpriseHeaders } from '@/lib/enterprise/guard'
export const dynamic='force-dynamic'
export async function POST(request:Request,{params}:{params:Promise<{accountId:string}>}){try{
 if(!isFeatureEnabled('enterprise_os'))throw new OutcomeError('ENTERPRISE_NOT_FOUND',404)
 const admin=await requireApiAdmin();if(!admin.ok)return admin.response
 const account=uuid((await params).accountId),input=parseEnterpriseRole(await readOutcomeJson(request)),sql=db()
 const[row]=await sql`select enterprise_set_role(${account}::uuid,${admin.profile.id}::uuid,${input.profileId}::uuid,${input.role},${input.expectedRevision},${input.requestId}::uuid,${input.reason}) as result`
 const status=['CREATED','REPLAYED'].includes(String(row?.result))?200:row?.result==='DENIED'?403:row?.result==='NOT_FOUND'?404:409
 return Response.json({status:row?.result??'CONFLICT'},{status,headers:enterpriseHeaders})
}catch(error){return enterpriseErrorResponse(error)}}
