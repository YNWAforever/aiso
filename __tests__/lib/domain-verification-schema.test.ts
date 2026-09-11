import { describe, expect, it } from 'vitest'
import {
  VERIFICATION_PATH,
  deriveVerificationState,
  issueVerificationToken,
  matchesVerificationToken,
  normalizeVerificationDomain,
} from '@/lib/domain-verification/schema'

/**
 * Domain-ownership verification (AC-03), pure half.
 *
 * Until now `verification: 'unverified'` was a literal in
 * lib/entities/schema.ts — a field that could only ever hold one value, so
 * the product stated a verification status it had no way to establish. These
 * are the rules that make it a real state.
 */

describe('normalizeVerificationDomain', () => {
  it.each([
    ['a bare host', 'Example.COM', 'example.com'],
    ['a full url', 'https://example.com/pricing?a=1', 'example.com'],
    ['a www host', 'www.example.com', 'www.example.com'],
    ['a trailing dot', 'example.com.', 'example.com'],
    ['surrounding space', '  example.com  ', 'example.com'],
  ])('normalises %s', (_label, input, expected) => {
    expect(normalizeVerificationDomain(input)).toBe(expected)
  })

  /**
   * An address literal cannot be owned in the sense this proves, and a
   * hostname with no dot is not a public domain. Both would otherwise become
   * verifiable targets pointing at infrastructure rather than a site.
   */
  it.each([
    ['an empty value', ''],
    ['a null value', null],
    ['an ipv4 literal', '127.0.0.1'],
    ['an ipv6 literal', '[::1]'],
    ['a bare hostname with no dot', 'localhost'],
    ['a host with a space', 'exa mple.com'],
    ['a non-http scheme', 'ftp://example.com'],
  ])('refuses %s', (_label, input) => {
    expect(normalizeVerificationDomain(input as string | null)).toBeNull()
  })
})

describe('issueVerificationToken', () => {
  it('is long enough not to be guessed, and url-safe', () => {
    expect(issueVerificationToken()).toMatch(/^aiso-site-verification=[0-9a-f]{32}$/)
  })

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => issueVerificationToken()))
    expect(tokens.size).toBe(50)
  })
})

describe('matchesVerificationToken', () => {
  const token = 'aiso-site-verification=0123456789abcdef0123456789abcdef'

  it('accepts the token as the whole file', () => {
    expect(matchesVerificationToken(token, token)).toBe(true)
  })

  it('accepts it as one line among others, ignoring surrounding whitespace', () => {
    expect(matchesVerificationToken(`# comment\r\n  ${token}  \n\n`, token)).toBe(true)
  })

  /**
   * Not a substring search. A soft-404 or error page that echoes the
   * requested URL back into its body would contain the token verbatim, and a
   * `body.includes(token)` check would read that as proof of ownership.
   */
  it('refuses a token merely embedded in surrounding text', () => {
    expect(matchesVerificationToken(`Not found: /${token}/oops`, token)).toBe(false)
    expect(matchesVerificationToken(`<html><body>${token}</body></html>`, token)).toBe(false)
  })

  it('refuses a different token, and an empty body', () => {
    expect(matchesVerificationToken('aiso-site-verification=deadbeef', token)).toBe(false)
    expect(matchesVerificationToken('', token)).toBe(false)
  })
})

describe('deriveVerificationState', () => {
  const verifiedAt = '2026-09-11T00:00:00.000Z'

  it('is verified when the proof was recorded for the domain still in use', () => {
    expect(deriveVerificationState({ verifiedAt, verifiedDomain: 'example.com' }, 'example.com'))
      .toBe('verified')
  })

  it('is unverified when nothing was ever recorded', () => {
    expect(deriveVerificationState(null, 'example.com')).toBe('unverified')
    expect(deriveVerificationState({ verifiedAt: null, verifiedDomain: 'example.com' }, 'example.com'))
      .toBe('unverified')
  })

  /**
   * The one that would otherwise be silent. Proving ownership of one domain
   * and then pointing the client at another must not carry the badge across —
   * a verified state that outlives the thing it verified is worse than none,
   * because the surface asserts something nobody proved.
   */
  it('does not survive the client being repointed at another domain', () => {
    expect(deriveVerificationState({ verifiedAt, verifiedDomain: 'example.com' }, 'other.com'))
      .toBe('unverified')
  })

  it('is unverified when the client has no domain at all', () => {
    expect(deriveVerificationState({ verifiedAt, verifiedDomain: 'example.com' }, null))
      .toBe('unverified')
  })
})

describe('VERIFICATION_PATH', () => {
  it('is a well-known path, so it cannot collide with a real page', () => {
    expect(VERIFICATION_PATH).toBe('/.well-known/aiso-site-verification.txt')
  })
})
