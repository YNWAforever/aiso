import 'server-only'
import { getProfile } from '@/lib/auth'
import { PublicUrlError, createPublicUrlFetcher } from '@/lib/security/public-url'
import {
  VERIFICATION_MAX_BYTES,
  VERIFICATION_PATH,
  deriveVerificationState,
  matchesVerificationToken,
} from './schema'
import {
  ensureVerificationToken,
  loadVerification,
  recordVerificationResult,
  type VerificationOutcome,
} from './store'

/**
 * Domain-ownership verification (AC-03), the acting half.
 *
 * The fetcher is NOT the shared `fetchPublicUrl`. It is the same hardened
 * machinery with `maxRedirects: 0`, and that difference is the security of
 * the whole feature.
 *
 * Following redirects is correct when scanning — a site legitimately moves
 * its pages — and wrong when proving ownership. A site that redirects
 * `/.well-known/*` to shared user-content hosting (a CDN, an uploads domain,
 * a docs platform) would let a file somebody else uploaded there stand as
 * proof of owning the redirecting domain. The proof has to come from the
 * origin being claimed, so a redirect is a refusal rather than a hop.
 *
 * `maxResponseBytes` is capped for the same reason the path is fixed: this
 * file is one short line, and anything willing to stream megabytes at us is
 * not it.
 */
const verificationFetch = createPublicUrlFetcher({
  maxRedirects: 0,
  maxResponseBytes: VERIFICATION_MAX_BYTES,
})

const statuses = {
  UNAUTHENTICATED: 401,
  CLIENT_NOT_FOUND: 404,
  NO_DOMAIN: 409,
  VERIFICATION_UNAVAILABLE: 503,
} as const

export class DomainVerificationError extends Error {
  readonly status: number
  constructor(readonly code: keyof typeof statuses) {
    super(code)
    this.name = 'DomainVerificationError'
    this.status = statuses[code]
  }
}

const headers = { 'Cache-Control': 'no-store' }

function errorResponse(error: unknown): Response {
  if (error instanceof DomainVerificationError) {
    return Response.json({ error: error.code }, { status: error.status, headers })
  }
  console.error('[domain-verification] failed:', (error as Error)?.message ?? String(error))
  return Response.json({ error: 'VERIFICATION_UNAVAILABLE' }, { status: 503, headers })
}

/**
 * Auth → ownership, in that order, in one place. There is no entitlement
 * step: proving you own your own domain is not a paid feature, and gating it
 * would make the honest state (`unverified`) the only one some plans could
 * ever show.
 */
async function owned(clientId: string) {
  // getProfile() throws when the session store itself is unavailable. That
  // reaches the caller's catch and becomes 503 — a dependency failure, which
  // is what it is. What it must never become is 401: telling a signed-in
  // owner they are signed out because an unrelated service is down.
  const profile = await getProfile()
  if (!profile) throw new DomainVerificationError('UNAUTHENTICATED')

  let row: Awaited<ReturnType<typeof loadVerification>>
  try {
    row = await loadVerification(profile.account_id, clientId)
  } catch {
    // Never let a failed lookup read as "not yours".
    throw new DomainVerificationError('VERIFICATION_UNAVAILABLE')
  }
  if (!row) throw new DomainVerificationError('CLIENT_NOT_FOUND')
  return { profile, row }
}

function view(row: Awaited<ReturnType<typeof loadVerification>> & object, token: string | null) {
  return {
    state: deriveVerificationState(row, row.currentDomain),
    domain: row.currentDomain,
    token,
    path: VERIFICATION_PATH,
    lastCheckedAt: row.lastCheckedAt,
    lastOutcome: row.lastOutcome,
  }
}

/** The token to publish, and where. Minted on first read for this domain. */
export async function readDomainVerification(clientId: string): Promise<Response> {
  try {
    const { profile, row } = await owned(clientId)
    if (!row.currentDomain) {
      // A client with no domain has nothing to prove. Saying so is better than
      // showing an unverified badge that no action could ever clear.
      throw new DomainVerificationError('NO_DOMAIN')
    }
    const token = await ensureVerificationToken(
      profile.account_id, clientId, profile.id, row.currentDomain,
    )
    const fresh = await loadVerification(profile.account_id, clientId)
    return Response.json(view(fresh ?? row, token), { headers })
  } catch (error) {
    return errorResponse(error)
  }
}

/** What the fetch found, in the closed vocabulary migration 048 allows. */
async function probe(domain: string, token: string): Promise<VerificationOutcome> {
  try {
    const response = await verificationFetch(`https://${domain}${VERIFICATION_PATH}`, {
      headers: { accept: 'text/plain' },
    })
    if (!response.ok) return 'token_absent'
    return matchesVerificationToken(await response.text(), token) ? 'verified' : 'token_absent'
  } catch (error) {
    if (error instanceof PublicUrlError) {
      if (error.code === 'TOO_MANY_REDIRECTS') return 'redirected'
      if (error.code === 'RESPONSE_TOO_LARGE') return 'too_large'
    }
    // Everything else — DNS, TLS, timeout, connection refused — is the site
    // not answering. It is not an error on our side and must not be a 5xx.
    return 'unreachable'
  }
}

export async function checkDomainVerification(clientId: string): Promise<Response> {
  try {
    const { profile, row } = await owned(clientId)
    if (!row.currentDomain) throw new DomainVerificationError('NO_DOMAIN')

    const token = await ensureVerificationToken(
      profile.account_id, clientId, profile.id, row.currentDomain,
    )
    if (!token) throw new DomainVerificationError('NO_DOMAIN')

    const outcome = await probe(row.currentDomain, token)
    // Recorded against the domain the token was issued for, so a domain
    // changed mid-check cannot inherit this result.
    await recordVerificationResult(profile.account_id, clientId, row.currentDomain, outcome)

    const fresh = await loadVerification(profile.account_id, clientId)
    return Response.json(view(fresh ?? row, token), { headers })
  } catch (error) {
    return errorResponse(error)
  }
}
