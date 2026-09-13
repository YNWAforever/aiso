import { describe, expect, it } from 'vitest'
import { normalizeAssetUrl, parseAssetLabel } from '@/lib/assets/schema'

/**
 * Page identity for a registered asset.
 *
 * AC-06 needs a page-level target, and neither side of the product retains one:
 * a scan finding keeps `url.origin` and reduces the path to a boolean
 * (`URL_REDACTION_VERSION = 'origin-only.v1'`), and a Pulse observation carries
 * no url at all. So the owner supplies it, and this is where an owner-typed
 * string becomes an identity two different subsystems can agree on.
 *
 * Normalisation is conservative in one specific direction: merging two URLs that
 * are really different pages silently moves one page's questions onto another
 * page's findings, which is worse than keeping two entries a human can see.
 */

describe('normalizeAssetUrl', () => {
  it('lowercases the scheme and host, which are case-insensitive', () => {
    expect(normalizeAssetUrl('HTTPS://Example.COM/Pricing')).toEqual({
      url: 'https://example.com/Pricing',
      origin: 'https://example.com',
    })
  })

  it('keeps the path case, which is not', () => {
    // /Pricing and /pricing are different resources on any case-sensitive server.
    expect(normalizeAssetUrl('https://example.com/Pricing')?.url).toBe('https://example.com/Pricing')
  })

  it('drops the fragment, which never reaches the server', () => {
    expect(normalizeAssetUrl('https://example.com/pricing#plans')?.url).toBe('https://example.com/pricing')
  })

  it('keeps the query, because it often IS the page', () => {
    // Dropping it would merge ?product=42 and ?product=43 into one asset, moving
    // one page's declared questions onto another page's findings.
    expect(normalizeAssetUrl('https://example.com/p?product=42')?.url).toBe('https://example.com/p?product=42')
  })

  it('drops a default port and keeps a non-default one', () => {
    expect(normalizeAssetUrl('https://example.com:443/a')?.url).toBe('https://example.com/a')
    expect(normalizeAssetUrl('https://example.com:8443/a')?.url).toBe('https://example.com:8443/a')
  })

  it('normalises an empty path to the root', () => {
    expect(normalizeAssetUrl('https://example.com')?.url).toBe('https://example.com/')
  })

  it('derives the origin, which is what a scan finding can be matched on', () => {
    expect(normalizeAssetUrl('https://example.com:8443/deep/page')?.origin).toBe('https://example.com:8443')
  })

  it.each([
    ['javascript:alert(1)', 'a scheme that is not http(s)'],
    ['data:text/html,hi', 'a data url'],
    ['ftp://example.com/f', 'a non-web scheme'],
    ['/relative/path', 'no scheme at all'],
    ['   ', 'whitespace'],
    ['https://user:pass@example.com/a', 'embedded credentials'],
    ['not a url', 'unparseable text'],
  ])('rejects %s (%s)', input => {
    expect(normalizeAssetUrl(input)).toBeNull()
  })

  it('rejects a url long enough to be a payload rather than a page', () => {
    expect(normalizeAssetUrl(`https://example.com/${'a'.repeat(2000)}`)).toBeNull()
  })
})

describe('parseAssetLabel', () => {
  it('trims and keeps a human label', () => {
    expect(parseAssetLabel('  Pricing page  ')).toBe('Pricing page')
  })

  it.each([['', 'empty'], ['   ', 'whitespace only'], ['x'.repeat(161), 'too long']])(
    'rejects %s (%s)',
    input => {
      expect(parseAssetLabel(input)).toBeNull()
    },
  )

  it('collapses interior whitespace so two labels do not differ invisibly', () => {
    expect(parseAssetLabel('Pricing    page')).toBe('Pricing page')
  })
})
