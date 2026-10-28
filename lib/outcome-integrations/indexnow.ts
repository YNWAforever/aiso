import 'server-only'
import { createPublicUrlFetcher, type PublicUrlFetch } from '@/lib/security/public-url'
import { normalizeBrandDomain } from '@/lib/integrations/search-console/binding'
import { canonicalOutcomeUrl, OutcomeError, type IndexNowInput } from './input'
import { beginOutcomeAttempt, finishOutcomeAttempt, type OutcomeScope } from './store'
import { db } from '@/lib/db'

// Key proof cannot follow a redirect to third-party uploads. Every hop also
// passes the shared DNS/public-address and pinned-connection checks.
const publicFetch = createPublicUrlFetcher({ allowedProtocols: ['https:'], maxRedirects: 0, maxResponseBytes: 4096, timeoutMs: 5000 })
type Dependencies = {
  key(scope: OutcomeScope): Promise<{ key: string; domain: string } | null>
  begin: typeof beginOutcomeAttempt
  finish: typeof finishOutcomeAttempt
  fetch: PublicUrlFetch
}
export async function loadIndexNowKey(scope: OutcomeScope) {
  const sql = db()
  const rows = await sql`select s.indexnow_key as key,c.domain from outcome_integration_settings s join clients c
    on c.id=s.client_id and c.account_id=s.account_id where s.account_id=${scope.accountId}::uuid and s.client_id=${scope.clientId}::uuid
    and s.indexnow_key is not null and s.bound_domain=c.domain`
  return rows[0] ? { key: String(rows[0].key), domain: String(rows[0].domain) } : null
}
const defaults: Dependencies = { key: loadIndexNowKey, begin: beginOutcomeAttempt, finish: finishOutcomeAttempt, fetch: publicFetch }

export async function submitIndexNow(scope: OutcomeScope, input: IndexNowInput, deps: Dependencies = defaults) {
  const config = await deps.key(scope)
  if (!config) throw new OutcomeError('INDEXNOW_SETUP_REQUIRED', 409)
  if (!normalizeBrandDomain(config.domain) || !/^[a-zA-Z0-9-]{8,128}$/.test(config.key)) throw new OutcomeError('INDEXNOW_SETUP_REQUIRED', 409)
  // Brand ownership permits www/apex equivalence; IndexNow proof and batches
  // use the exact canonical host supplied by the owner, including www.
  const host = new URL(canonicalOutcomeUrl(input.urls[0], config.domain)).hostname
  for (const url of input.urls) {
    const parsed = new URL(canonicalOutcomeUrl(url, config.domain))
    if (parsed.hostname !== host || parsed.protocol !== 'https:') throw new OutcomeError('INVALID_OUTCOME_INPUT')
  }
  const keyLocation = `https://${host}/${config.key}.txt`
  // Include the public key/config in the intent hash, never encrypted secrets.
  const claimed = await deps.begin(scope, 'indexnow', input.intentKey, { ...input, host, keyLocation })
  if (!claimed.claimed) return claimed.attempt
  let status = 'blocked', reason = 'KEY_VERIFICATION_FAILED', httpStatus: number | null = null
  let sending = false
  try {
    const proof = await deps.fetch(keyLocation)
    const valid = proof.ok && (await proof.text()).trim() === config.key
    if (!valid) await proof.body?.cancel().catch(() => {})
    else {
      sending = true
      const result = await deps.fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, key: config.key, keyLocation, urlList: input.urls }) })
      httpStatus = result.status
      await result.body?.cancel()
      status = [200, 202].includes(result.status) ? 'succeeded' : 'failed'
      reason = status === 'succeeded' ? 'ACCEPTED_NOT_INDEXING_PROOF' : 'PROVIDER_REFUSED'
    }
  } catch {
    status = sending ? 'unknown' : 'blocked'
    reason = sending ? 'DELIVERY_UNCONFIRMED' : 'KEY_VERIFICATION_UNAVAILABLE'
  }
  // A failed receipt write propagates; a successful HTTP result alone is not
  // reported as durable success. Running claims are repaired to unknown later.
  await deps.finish(scope, claimed.attempt.id, status, reason, httpStatus)
  return { id: claimed.attempt.id, status, reason }
}
