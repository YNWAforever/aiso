import { describe, expect, it } from 'vitest'
import { EDIT_SPEC_MAX_DEPTH, EDIT_SPEC_PAYLOAD_MAX_BYTES, EditSpecError, parseEditSpec, type JsonLdEditSpec } from '@/lib/site-edit/edit-spec'
const parseJsonLd = (value: unknown) => parseEditSpec(value) as JsonLdEditSpec
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
    const spec = parseJsonLd({ ...faq, payload: { mainEntity: faq.payload.mainEntity, '@type': 'FAQPage', '@context': 'https://schema.org' } })
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

describe('S9 meta kind (page title and/or meta description)', () => {
  const meta = { schemaVersion: 1, kind: 'meta', targetUrl: 'https://www.example.com/menu', title: 'Menu · Example Bakery', description: 'Fresh bread daily in Sai Ying Pun.' }
  it('accepts a title and/or a description, trimmed and NFC, and is canonical', () => {
    const spec = parseEditSpec({ ...meta, title: '  Café menu ', description: null })
    expect(spec).toEqual({ schemaVersion: 1, kind: 'meta', targetUrl: 'https://www.example.com/menu', title: 'Café menu', description: null })
    expect(parseEditSpec(spec)).toEqual(spec)
    expect(parseEditSpec({ ...meta, title: '' })).toMatchObject({ title: null, description: meta.description }) // empty = leave as is
    expect(parseEditSpec(meta)).toEqual(meta)
  })
  it('refuses nothing to change, markup, line breaks, controls, over-long text and wrong shapes', () => {
    expect(code({ ...meta, title: null, description: '   ' })).toBe('meta')
    expect(code({ ...meta, title: 'Menu <b>new</b>' })).toBe('markup')
    expect(code({ ...meta, description: 'a > b' })).toBe('markup')
    expect(code({ ...meta, title: 'Line one\nline two' })).toBe('meta')
    expect(code({ ...meta, title: 'Tab\there' })).toBe('meta')
    expect(code({ ...meta, title: 'x'.repeat(201) })).toBe('meta')
    expect(code({ ...meta, title: '字'.repeat(200) })).toBeNull() // characters, not bytes
    expect(code({ ...meta, description: 'x'.repeat(501) })).toBe('meta')
    expect(code({ ...meta, title: 42 })).toBe('meta')
    expect(code({ ...meta, schemaType: 'FAQPage' })).toBe('shape') // no JSON-LD keys on a meta spec
    const { description: _d, ...missing } = meta
    expect(code(missing)).toBe('shape')
    expect(code({ ...meta, targetUrl: 'http://www.example.com/' })).toBe('url')
  })
})

describe('S10 llms_txt kind (the domain root /llms.txt)', () => {
  const llms = { schemaVersion: 1, kind: 'llms_txt', targetUrl: 'https://www.example.com/llms.txt', content: '# Example Bakery\n\n> Fresh bread daily.\n' }
  it('accepts the root file, normalising line endings and NFC, and keeps Markdown as written', () => {
    const spec = parseEditSpec({ ...llms, content: '# Café\r\n\r\n- [Menu](https://www.example.com/menu): <b>daily</b>\r\n' })
    expect(spec).toEqual({ ...llms, content: '# Café\n\n- [Menu](https://www.example.com/menu): <b>daily</b>\n' })
    expect(parseEditSpec(spec)).toEqual(spec)
    expect(parseEditSpec({ ...llms, content: 'Tab\tok\n' })).toMatchObject({ content: 'Tab\tok\n' })
  })
  it('refuses another path, a query, blank or oversized text, controls and wrong shapes', () => {
    expect(code({ ...llms, targetUrl: 'https://www.example.com/docs/llms.txt' })).toBe('url')
    expect(code({ ...llms, targetUrl: 'https://www.example.com/llms.txt?v=2' })).toBe('url')
    expect(code({ ...llms, targetUrl: 'https://www.example.com/llms-full.txt' })).toBe('url')
    expect(code({ ...llms, content: ' \n\t\n' })).toBe('llms')
    expect(code({ ...llms, content: 'bell\u0007' })).toBe('llms')
    expect(code({ ...llms, content: 'x'.repeat(16 * 1024 + 1) })).toBe('size')
    expect(code({ ...llms, content: 'x'.repeat(16 * 1024) })).toBeNull()
    expect(code({ ...llms, content: 7 })).toBe('llms')
    expect(code({ ...llms, title: 'x' })).toBe('shape')
    const { content: _c, ...missing } = llms
    expect(code(missing)).toBe('shape')
  })
})
