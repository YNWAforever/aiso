import { getProfile } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { verifyClientOwnership } from '@/lib/localTrust/store'
import { OutcomeError, UUID } from './input'

export async function authorizeOutcomeClient(clientId: string) {
  if (!isFeatureEnabled('outcome_integrations')) throw new OutcomeError('OUTCOME_NOT_FOUND', 404)
  let profile
  try { profile = await getProfile() } catch { throw new OutcomeError('OUTCOME_UNAVAILABLE', 503) }
  if (!profile) throw new OutcomeError('UNAUTHENTICATED', 401)
  if (!resolveCommercialEntitlement(profile.accounts).features.outcome_integrations) throw new OutcomeError('UPGRADE_REQUIRED', 403)
  if (!UUID.test(clientId)) throw new OutcomeError('OUTCOME_NOT_FOUND', 404)
  let client
  try { client = await verifyClientOwnership(clientId, profile.account_id) }
  catch { throw new OutcomeError('OUTCOME_UNAVAILABLE', 503) }
  if (!client) throw new OutcomeError('OUTCOME_NOT_FOUND', 404)
  return { profile, client, scope: { accountId: profile.account_id, clientId: client.id } }
}

export const outcomeHeaders = { 'Cache-Control': 'no-store' }
export function outcomeErrorResponse(error: unknown): Response {
  if (error instanceof OutcomeError) return Response.json({ error: error.code }, { status: error.status, headers: outcomeHeaders })
  // Allowlisted context only. Driver and provider objects can contain secrets.
  console.error({ event: 'outcome_operation_failed', reason: 'dependency_unavailable' })
  return Response.json({ error: 'OUTCOME_UNAVAILABLE' }, { status: 503, headers: outcomeHeaders })
}
