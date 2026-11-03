import { normalizeVerificationDomain } from '@/lib/domain-verification/schema'
import type { EditSpecV1 } from './edit-spec'

const apex = (host: string) => host.replace(/^www\./, '')

/**
 * The target must be on the brand's verified domain: the same host, or its
 * www/apex pair (either way round, so a brand stored as `www.bakery.hk` can
 * edit `bakery.hk` too). Other subdomains are refused, so verifying one host
 * never authorizes edits on another. Hosts go through the same normalizer
 * the verification itself uses, so the two can never disagree on a host.
 */
export function editSpecTargetsDomain(spec: Pick<EditSpecV1, 'targetUrl'>, verifiedDomain: string): boolean {
  const domain = normalizeVerificationDomain(verifiedDomain)
  const host = normalizeVerificationDomain(spec.targetUrl)
  if (!domain || !host) return false
  return host === domain || apex(host) === apex(domain)
}
