import 'server-only'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { verifyClientOwnership } from '@/lib/localTrust/store'
import { OutcomeError,UUID } from '@/lib/outcome-integrations/input'
import type { EnterpriseRole } from './input'
export type EnterpriseCapability='white_label_portals'|'scheduled_reports'|'public_api'|'webhooks'|'enterprise_workflows'|'multi_market_benchmarks'|'custom_adapters'
export const ENTERPRISE_CAPABILITIES:EnterpriseCapability[]=['white_label_portals','scheduled_reports','public_api','webhooks','enterprise_workflows','multi_market_benchmarks','custom_adapters']
export async function enterpriseRole(accountId:string,actorId:string){const sql=db();const [r]=await sql`select enterprise_member_role(${accountId}::uuid,${actorId}::uuid) as role`;return r?.role as EnterpriseRole|null}
export function requireEnterpriseRole(role:EnterpriseRole|null,minimum:EnterpriseRole){if(!role||({viewer:0,editor:1,manager:2}[role]<{viewer:0,editor:1,manager:2}[minimum]))throw new OutcomeError('ENTERPRISE_FORBIDDEN',403)}
export async function authorizeEnterprise(clientId:string,capability:EnterpriseCapability='enterprise_workflows',minimum:EnterpriseRole='viewer'){
 if(!isFeatureEnabled('enterprise_os'))throw new OutcomeError('ENTERPRISE_NOT_FOUND',404)
 const profile=await getProfile();if(!profile)throw new OutcomeError('UNAUTHENTICATED',401)
 if(!resolveCommercialEntitlement(profile.accounts).features[capability])throw new OutcomeError('UPGRADE_REQUIRED',403)
 if(!UUID.test(clientId))throw new OutcomeError('ENTERPRISE_NOT_FOUND',404)
 const client=await verifyClientOwnership(clientId,profile.account_id);if(!client)throw new OutcomeError('ENTERPRISE_NOT_FOUND',404)
 const role=await enterpriseRole(profile.account_id,profile.id);requireEnterpriseRole(role,minimum)
 return{profile,client,role:role!,scope:{accountId:profile.account_id,clientId:client.id}}
}
export { outcomeErrorResponse as enterpriseErrorResponse,outcomeHeaders as enterpriseHeaders } from '@/lib/outcome-integrations/guard'
