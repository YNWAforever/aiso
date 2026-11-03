import 'server-only'
import { loadVerification } from '@/lib/domain-verification/store'
import { deriveVerificationState } from '@/lib/domain-verification/schema'
import type { EditSpecV1 } from './edit-spec'
import { editSpecTargetsDomain } from './target-domain'

export type EditSpecDomainResult = 'ok' | 'unverified' | 'mismatch'

/**
 * What the check saw, so a write can require it still holds in the same
 * statement: the client's stored domain (raw, as the column holds it) and the
 * verified domain. Verification is set forward only and cleared only by
 * re-pointing (053), so pinning these two closes the check-then-write gap.
 */
export type EditSpecDomainPin = { clientDomain: string; verifiedDomain: string }

export async function checkEditSpecDomainPinned(accountId: string, clientId: string, spec: EditSpecV1): Promise<{ result: EditSpecDomainResult; pin: EditSpecDomainPin | null }> {
  const row = await loadVerification(accountId, clientId)
  if (!row || deriveVerificationState(row, row.currentDomain) !== 'verified' || !row.currentDomain || !row.currentDomainRaw) return { result: 'unverified', pin: null }
  if (!editSpecTargetsDomain(spec, row.currentDomain)) return { result: 'mismatch', pin: null }
  return { result: 'ok', pin: { clientDomain: row.currentDomainRaw, verifiedDomain: row.verifiedDomain } }
}

/**
 * An edit spec may only target the brand's own domain, and only once that
 * domain is verified (053): a verification belongs to a (client, domain)
 * pair, so repointing the brand at another domain drops it. Checked at draft
 * save and again at version submit; a historical version is never re-checked
 * on read, because its approval stands for what it was approved against.
 */
export async function checkEditSpecDomain(accountId: string, clientId: string, spec: EditSpecV1): Promise<EditSpecDomainResult> {
  return (await checkEditSpecDomainPinned(accountId, clientId, spec)).result
}
