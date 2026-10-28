import { getProfile } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { verifyClientOwnership } from '@/lib/localTrust/store'
import { OutcomeError,UUID } from '@/lib/outcome-integrations/input'
export async function authorizeVisibilityClient(clientId:string) {
  if(!isFeatureEnabled('closed_loop_visibility'))throw new OutcomeError('VISIBILITY_NOT_FOUND',404)
  const profile=await getProfile()
  if(!profile)throw new OutcomeError('UNAUTHENTICATED',401)
  if(!resolveCommercialEntitlement(profile.accounts).features.closed_loop_visibility)throw new OutcomeError('UPGRADE_REQUIRED',403)
  if(!UUID.test(clientId))throw new OutcomeError('VISIBILITY_NOT_FOUND',404)
  const client=await verifyClientOwnership(clientId,profile.account_id)
  if(!client)throw new OutcomeError('VISIBILITY_NOT_FOUND',404)
  return{profile,client,scope:{accountId:profile.account_id,clientId:client.id}}
}
