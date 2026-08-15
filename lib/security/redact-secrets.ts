/**
 * Strip credentials from arbitrary command or error output.
 *
 * Dependency-free and side-effect-free: scripts/redact.mjs loads this by
 * relative path under plain node, which strips types but cannot resolve the
 * `@/` alias. Adding any import breaks the wrapper that pipes neonctl through it.
 *
 * Hosts are kept deliberately: knowing which endpoint answered is what stops
 * someone seeding production by accident.
 *
 * Scanning is procedural rather than one regex. A regex version of this failed
 * open on three real shapes -- a raw `/`, a space, or an empty username inside
 * the credential -- and backtracked quadratically, hanging on long non-matching
 * lines. This is the last line of defence before a live credential reaches a
 * terminal, so every operation here is linear and it errs toward over-redacting.
 *
 * Known limit: a credential split across a line break by terminal wrapping is
 * only partly caught, by the token pass below. Do not rely on this to sanitise
 * re-wrapped output.
 */

/** Neon secrets travel as `npg_…`; allow the separators a generated one can hold. */
const NEON_TOKEN = /npg_[A-Za-z0-9_-]{4,}/g

/** Three base64url segments -- a JWT, such as the n8n bearer token. */
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g

export function redactSecrets(text: string): string {
  if (!text) return text
  return text.split('\n').map(redactLine).join('\n')
}

function redactLine(line: string): string {
  return redactUris(line).replace(NEON_TOKEN, 'npg_***').replace(JWT, '***jwt***')
}

function redactUris(line: string): string {
  let out = ''
  let cursor = 0

  for (;;) {
    const marker = line.indexOf('://', cursor)
    if (marker === -1) return out + line.slice(cursor)

    const start = marker + 3
    out += line.slice(cursor, start)

    const at = credentialEnd(line, start)
    if (at === -1) {
      cursor = start
      continue
    }

    const userinfo = line.slice(start, at)
    const colon = userinfo.indexOf(':')
    // No colon means no password -- a bare `scheme://user@host`. Leave it be
    // rather than inventing a `:***` that implies a secret was there.
    out += colon === -1 ? `${userinfo}@` : `${userinfo.slice(0, colon)}:***@`
    cursor = at + 1
  }
}

/**
 * Index of the `@` ending the credential after `://`, or -1.
 *
 * Normally that is the last `@` before the path delimiter. When the credential
 * itself contains a raw `/` the delimiter lands inside the secret, so fall back
 * to the last `@` on the line -- but only when the text between looks like
 * userinfo (contains a `:`), so prose carrying a URL and an email address is
 * left alone.
 */
function credentialEnd(line: string, start: number): number {
  let delimiter = line.length
  for (let i = start; i < line.length; i++) {
    const c = line[i]
    if (c === '/' || c === '?' || c === '#') { delimiter = i; break }
  }

  const direct = line.lastIndexOf('@', delimiter - 1)
  if (direct >= start) return direct

  const fallback = line.lastIndexOf('@')
  if (fallback >= start && line.slice(start, fallback).includes(':')) return fallback

  return -1
}
