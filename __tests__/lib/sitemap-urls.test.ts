import { describe, it, expect } from 'vitest'
import {
  MAX_SITEMAP_URLS,
  normalizeSitemapUrls,
  parseSitemapUrls,
} from '@/lib/security/sitemap-urls'

const url = (n: number) => `https://example.com/page-${n}`

describe('parseSitemapUrls', () => {
  it('treats an absent value as an empty list', () => {
    expect(parseSitemapUrls(undefined)).toEqual({ ok: true, urls: [] })
    expect(parseSitemapUrls(null)).toEqual({ ok: true, urls: [] })
  })

  it('accepts and normalizes http and https urls', () => {
    expect(parseSitemapUrls(['https://example.com/a', ' http://example.com/b '])).toEqual({
      ok: true,
      urls: ['https://example.com/a', 'http://example.com/b'],
    })
  })

  it.each([
    // The shape that actually shipped: a bare string has .length, so it passed
    // the route's emptiness check and reached .filter() inside the check.
    ['a bare string', 'https://example.com/x', 'not_an_array'],
    ['an object', { 0: 'https://example.com' }, 'not_an_array'],
    ['a non-string element', [123], 'not_a_string'],
    ['an unparseable element', ['not a url'], 'unparseable'],
    ['a file: url', ['file:///etc/passwd'], 'bad_protocol'],
    ['a javascript: url', ['javascript:alert(1)'], 'bad_protocol'],
    ['embedded credentials', ['https://user:pass@example.com/'], 'bad_protocol'],
  ])('rejects %s', (_label, input, reason) => {
    expect(parseSitemapUrls(input)).toEqual({ ok: false, reason })
  })

  it('accepts exactly the cap and rejects one past it', () => {
    const atCap = Array.from({ length: MAX_SITEMAP_URLS }, (_, i) => url(i))
    expect(parseSitemapUrls(atCap)).toMatchObject({ ok: true })

    // Rejected, not truncated: the route truncates a sitemap it fetched itself,
    // but an oversized caller-supplied list is a signal worth surfacing.
    expect(parseSitemapUrls([...atCap, url(MAX_SITEMAP_URLS)])).toEqual({
      ok: false,
      reason: 'too_many',
    })
  })

  it('rejects an over-long element', () => {
    expect(parseSitemapUrls([`https://example.com/${'a'.repeat(2100)}`])).toEqual({
      ok: false,
      reason: 'too_long',
    })
  })
})

describe('normalizeSitemapUrls', () => {
  it.each([
    ['a bare string', 'https://example.com/x'],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', {}],
  ])('returns an empty list for %s rather than throwing', (_label, input) => {
    expect(normalizeSitemapUrls(input)).toEqual([])
  })

  it('drops unusable entries instead of rejecting the whole list', () => {
    expect(normalizeSitemapUrls([
      'https://example.com/keep',
      'file:///etc/passwd',
      123,
      'not a url',
    ])).toEqual(['https://example.com/keep'])
  })

  it('caps a long list rather than rejecting it', () => {
    const oversized = Array.from({ length: MAX_SITEMAP_URLS + 50 }, (_, i) => url(i))
    expect(normalizeSitemapUrls(oversized)).toHaveLength(MAX_SITEMAP_URLS)
  })
})
