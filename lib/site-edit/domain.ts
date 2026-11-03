import 'server-only'
import { loadVerification } from '@/lib/domain-verification/store'
import { deriveVerificationState } from '@/lib/domain-verification/schema'
import { editSpecTargetsDomain, type EditSpecV1 } from './edit-spec'

export type EditSpecDomainResult = 'ok' | 'unverified' | 'mismatch'

/**
 * An edit spec may only target the brand's own domain, and only once that
 * domain is verified (053): a verification belongs to a (client, domain)
 * pair, so repointing the brand at another domain drops it. Checked at draft
 * save and again at version submit; a historical version is never re-checked
 * on read, because its approval stands for what it was approved against.
 */
export async function checkEditSpecDomain(accountId: string, clientId: string, spec: EditSpecV1): Promise<EditSpecDomainResult> {
  const row = await loadVerification(accountId, clientId)
  if (!row || deriveVerificationState(row, row.currentDomain) !== 'verified' || !row.currentDomain) return 'unverified'
  return editSpecTargetsDomain(spec, row.currentDomain) ? 'ok' : 'mismatch'
}
