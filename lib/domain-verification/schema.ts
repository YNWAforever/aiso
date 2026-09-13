import { randomBytes } from 'node:crypto'

/**
 * Domain-ownership verification (AC-03), pure half.
 *
 * `verification: 'unverified'` was a literal in lib/entities/schema.ts — a
 * field whose type admitted exactly one value. The product displayed a
 * verification status it had no mechanism to establish, which is a claim
 * about the world backed by nothing. These are the rules that make it real.
 *
 * The method is a file at a well-known path, not a DNS TXT record. Both are
 * standard; this one is chosen because the scan engine already owns a
 * hardened HTTP fetcher that pins DNS and revalidates every redirect hop
 * (lib/security/public-url.ts), and adding a DNS resolver would be a second
 * network surface to secure for no extra assurance.
 */

/** Fixed. A well-known path cannot collide with a page the owner publishes. */
export const VERIFICATION_PATH = '/.well-known/aiso-site-verification.txt'

/** The file is one short line. Anything larger is not our file. */
export const VERIFICATION_MAX_BYTES = 4096

const TOKEN_PREFIX = 'aiso-site-verification='
const TOKEN_PATTERN = new RegExp(`^${TOKEN_PREFIX}[0-9a-f]{32}$`)

/**
 * The token is PUBLIC by design — the owner publishes it on their own site —
 * so it is stored in plain text. Hashing it would be theatre: the verifier
 * has to compare against the literal value it told the owner to publish.
 *
 * 128 bits, so it cannot be guessed by anyone who can only observe that some
 * token exists.
 */
export function issueVerificationToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(16).toString('hex')}`
}

export function isVerificationToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

/**
 * `clients.domain` is free text — it may be a bare host or a whole URL — so
 * it is normalised to one spelling before anything compares two of them.
 *
 * Address literals and dotless hostnames are refused: neither is a domain
 * anybody can own in the sense this proves, and accepting them would make
 * infrastructure a verifiable target.
 */
export function normalizeVerificationDomain(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return null

  let host: string
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    host = url.hostname
  } catch {
    return null
  }

  // URL keeps an ipv6 literal in brackets; ipv4 is four dotted numbers.
  if (host.startsWith('[')) return null
  const normalized = host.replace(/\.$/, '').toLowerCase()
  if (!normalized.includes('.')) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) return null
  return normalized
}

/**
 * Line-equality, never substring.
 *
 * A soft-404 that echoes the requested path, or any page that happens to
 * quote the token, would satisfy `body.includes(token)` — and that reads a
 * server's error message as proof of ownership. Requiring the token to BE a
 * line means the owner had to put it there deliberately.
 */
export function matchesVerificationToken(body: string, token: string): boolean {
  if (!isVerificationToken(token)) return false
  return body.split(/\r?\n/).some(line => line.trim() === token)
}

export type VerificationRecord = {
  verifiedAt: string | null
  /** The domain the proof was recorded FOR, which may no longer be in use. */
  verifiedDomain: string
}

export type VerificationState = 'verified' | 'unverified'

/**
 * Verified is a fact about a (client, domain) pair, never about the client
 * alone. Proving ownership of one domain and then repointing the client at
 * another must not carry the badge across — a verified state that outlives
 * the thing it verified asserts something nobody proved, which is worse than
 * showing nothing.
 */
export function deriveVerificationState(
  record: VerificationRecord | null,
  currentDomain: string | null,
): VerificationState {
  if (!record || record.verifiedAt === null || currentDomain === null) return 'unverified'
  return record.verifiedDomain === currentDomain ? 'verified' : 'unverified'
}
