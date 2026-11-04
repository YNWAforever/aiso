import { describe, expect, it } from 'vitest'
import { EDIT_SPEC_MAX_DEPTH, EDIT_SPEC_PAYLOAD_MAX_BYTES, EditSpecError, parseEditSpec } from '@/lib/site-edit/edit-spec'
import { editSpecTargetsDomain } from '@/lib/site-edit/target-domain'

const faq = {
  schemaVersion: 1,
  kind: 'jsonld',
  targetUrl: 'https://www.example.com/faq',
  schemaType: 'FAQPage',
  payload: {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [{ '@type': 'Question', name: 'Do you bake sourdough?', acceptedAnswer: { '@type': 'Answer', text: 'Yes, daily.' } }],
  },
}

const code = (value: unknown) => {
  try { parseEditSpec(value); return null } catch (error) { return error instanceof EditSpecError ? error.code : 'other' }
}

describe('parseEditSpec', () => {
  it('accepts one schema.org JSON-LD block and canonicalizes key order', () => {
    const spec = parseEditSpec({ ...faq, payload: { mainEntity: faq.payload.mainEntity, '@type': 'FAQPage', '@context': 'https://schema.org' } })
    expect(Object.keys(spec.payload)).toEqual(['@context', '@type', 'mainEntity'])
    expect(parseEditSpec(spec)).toEqual(spec)
    expect(JSON.stringify(parseEditSpec(faq))).toBe(JSON.stringify(spec))
  })

  it.each([
    ['extra key', { ...faq, extra: 1 }, 'shape'],
    ['missing key', Object.fromEntries(Object.entries(faq).filter(([key]) => key !== 'payload')), 'shape'],
    ['wrong kind', { ...faq, kind: 'html' }, 'shape'],
    ['wrong schema version', { ...faq, schemaVersion: 2 }, 'shape'],
    ['http URL', { ...faq, targetUrl: 'http://www.example.com/faq' }, 'url'],
    ['javascript URL', { ...faq, targetUrl: 'javascript:alert(1)' }, 'url'],
    ['credentials in URL', { ...faq, targetUrl: 'https://user:pw@www.example.com/' }, 'url'],
    ['fragment', { ...faq, targetUrl: 'https://www.example.com/faq#q1' }, 'url'],
    ['bare trailing #', { ...faq, targetUrl: 'https://www.example.com/faq#' }, 'url'],
    ['explicit port', { ...faq, targetUrl: 'https://www.example.com:8443/faq' }, 'url'],
    ['single-label host', { ...faq, targetUrl: 'https://localhost/faq' }, 'url'],
    ['over-long URL', { ...faq, targetUrl: `https://www.example.com/${'a'.repeat(2100)}` }, 'url'],
    ['unlisted type', { ...faq, schemaType: 'Product', payload: { ...faq.payload, '@type': 'Product' } }, 'type'],
    ['type mismatch', { ...faq, schemaType: 'Organization' }, 'type'],
    ['non-schema.org context', { ...faq, payload: { ...faq.payload, '@context': 'https://evil.example' } }, 'payload'],
    ['array payload', { ...faq, payload: [] }, 'payload'],
    ['script breakout in a value', { ...faq, payload: { ...faq.payload, name: 'x</script><script>alert(1)' } }, 'markup'],
    ['comment opener in a value', { ...faq, payload: { ...faq.payload, name: 'x<!-- y' } }, 'markup'],
    ['breakout in a key', { ...faq, payload: { ...faq.payload, '</SCRIPT>': 1 } }, 'markup'],
    ['non-finite number', { ...faq, payload: { ...faq.payload, n: Number.POSITIVE_INFINITY } }, 'payload'],
    // Postgres jsonb refuses these; they must be a 400 here, not a 503 at the write.
    ['NUL in a value', { ...faq, payload: { ...faq.payload, name: 'a\u0000b' } }, 'payload'],
    ['lone surrogate in a value', { ...faq, payload: { ...faq.payload, name: 'a\ud800b' } }, 'payload'],
    ['NUL in a key', { ...faq, payload: { ...faq.payload, 'a\u0000': 1 } }, 'payload'],
    ['other control char', { ...faq, payload: { ...faq.payload, name: 'a\u0007b' } }, 'payload'],
  ])('refuses %s', (_name, value, expected) => {
    expect(code(value)).toBe(expected)
  })

  it('refuses an over-deep payload', () => {
    let nested: Record<string, unknown> = { leaf: true }
    for (let i = 0; i < EDIT_SPEC_MAX_DEPTH + 1; i++) nested = { nested }
    expect(code({ ...faq, payload: { ...faq.payload, nested } })).toBe('payload')
  })

  it('refuses an oversized payload', () => {
    expect(code({ ...faq, payload: { ...faq.payload, description: 'x'.repeat(EDIT_SPEC_PAYLOAD_MAX_BYTES) } })).toBe('size')
  })

  it('allows ordinary HTML-free text including angle brackets that cannot break out', () => {
    expect(code({ ...faq, payload: { ...faq.payload, description: 'Prices from 3 < 5 dollars' } })).toBeNull()
  })

  it('allows tabs, newlines and paired surrogates (emoji, CJK extension)', () => {
    expect(code({ ...faq, payload: { ...faq.payload, description: 'Line 1\n\tLine 2 😀 𠀀' } })).toBeNull()
  })
})

describe('editSpecTargetsDomain', () => {
  const spec = (targetUrl: string) => ({ targetUrl })
  it.each([
    ['https://example.com/faq', 'example.com', true],
    ['https://www.example.com/faq', 'example.com', true],
    ['https://WWW.Example.com/faq', 'example.com.', true],
    ['https://shop.example.com/faq', 'example.com', false],
    ['https://example.com.evil.net/faq', 'example.com', false],
    ['https://notexample.com/faq', 'example.com', false],
    ['https://example.com/faq', '', false],
    // www/apex pair works either way round.
    ['https://bakery.hk/faq', 'www.bakery.hk', true],
    ['https://www.bakery.hk/faq', 'www.bakery.hk', true],
    ['https://shop.bakery.hk/faq', 'www.bakery.hk', false],
    ['https://www.www.example.com/', 'example.com', false],
    ['https://1.2.3.4/', '1.2.3.4', false],
  ])('%s on verified %j → %s', (url, domain, expected) => {
    expect(editSpecTargetsDomain(spec(url), domain)).toBe(expected)
  })
})

describe('S5 revert kind', () => {
  const base = { schemaVersion: 1, targetUrl: 'https://www.example.com/', schemaType: 'Organization',
    payload: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Example' } }
  it('accepts jsonld_remove under the same payload rules, and refuses any other kind', () => {
    expect(parseEditSpec({ ...base, kind: 'jsonld_remove' })).toMatchObject({ kind: 'jsonld_remove', schemaType: 'Organization' })
    expect(() => parseEditSpec({ ...base, kind: 'jsonld_replace' })).toThrow()
    expect(() => parseEditSpec({ ...base, kind: 'jsonld_remove', payload: { '@type': 'Organization' } })).toThrow()
  })
})
