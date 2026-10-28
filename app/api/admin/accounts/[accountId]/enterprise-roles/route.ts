import { requireApiAdmin } from '@/lib/admin-guard'
import { isFeatureEnabled } from '@/lib/flags'
import { uuid,OutcomeError } from '@/lib/outcome-integrations/input'
import { readOutcomeJson } from '@/lib/outcome-integrations/request'
import { setEnterpriseRole } from '@/lib/enterprise/roles'
import { parseEnterpriseRole } from '@/lib/enterprise/input'
import { enterpriseErrorResponse,enterpriseHeaders } from '@/lib/enterprise/guard'
export const dynamic='force-dynamic'
export async function POST(request:Request,{params}:{params:Promise<{accountId:string}>}){try{
 if(!isFeatureEnabled('enterprise_os'))throw new OutcomeError('ENTERPRISE_NOT_FOUND',404)
 const admin=await requireApiAdmin();if(!admin.ok)return admin.response
 const account=uuid((await params).accountId),input=parseEnterpriseRole(await readOutcomeJson(request))
 return Response.json(await setEnterpriseRole(account,admin.profile.id,input),{headers:enterpriseHeaders})
}catch(error){return enterpriseErrorResponse(error)}}
