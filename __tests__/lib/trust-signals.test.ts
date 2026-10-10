import { describe, it, expect } from 'vitest'
import { assessTrustSignals, TRUST_SIGNAL_KEYS, TRUST_SIGNALS_VERSION } from '@/lib/trust-signals'

const page = (head: string, body: string) => `<html><head>${head}</head><body>${body}</body></html>`
const jsonLd = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`
const status = (html: string, key: string, url = 'https://example.com/') =>
  assessTrustSignals(html, url).signals.find(s => s.key === key)?.status

const RICH = page(
  jsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'LocalBusiness', name: 'Acme', sameAs: ['https://www.linkedin.com/company/acme'],
        telephone: '+852 1234 5678', address: { '@type': 'PostalAddress', streetAddress: '1 Queen\'s Road' },
        award: 'HK Business Award 2025', aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.6', reviewCount: '120' } },
      { '@type': 'Article', author: { '@type': 'Person', name: 'Jane Lee' }, datePublished: '2026-09-01' },
    ],
  }),
  '<a href="/about-us">About us</a><a href="/contact">Contact</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms</a>',
)

describe('assessTrustSignals', () => {
  it('returns every signal once, in a fixed order, with its version', () => {
    const result = assessTrustSignals(RICH, 'https://example.com/')
    expect(result.version).toBe(TRUST_SIGNALS_VERSION)
    expect(result.signals.map(s => s.key)).toEqual([...TRUST_SIGNAL_KEYS])
  })

  it('passes a page that shows every signal', () => {
    expect(assessTrustSignals(RICH, 'https://example.com/').signals.every(s => s.status === 'pass')).toBe(true)
  })

  it('fails a bare page on every signal except HTTPS', () => {
    const bare = assessTrustSignals(page('', '<p>Hello</p>'), 'https://example.com/')
    expect(bare.signals.filter(s => s.status === 'pass').map(s => s.key)).toEqual(['https'])
  })

  it.each([
    ['meta author', page('<meta name="author" content="Jane Lee">', '')],
    ['rel=author', page('', '<a rel="author" href="/jane">Jane</a>')],
    ['byline class', page('', '<span class="post-byline">By Jane Lee</span>')],
  ])('finds an author from %s', (_label, html) => {
    expect(status(html, 'author')).toBe('pass')
  })

  it('warns when the organisation is described but links to no profiles', () => {
    expect(status(page(jsonLd({ '@type': 'Organization', name: 'Acme' }), ''), 'organization')).toBe('warn')
  })

  it.each([
    ['a tel: link', '<a href="tel:+85212345678">Call</a>'],
    ['a mailto: link', '<a href="mailto:hi@example.com">Email</a>'],
    ['a Chinese contact link', '<a href="/zh/lianxi">聯絡我們</a>'],
  ])('finds contact details from %s', (_label, body) => {
    expect(status(page('', body), 'contact')).toBe('pass')
  })

  it('finds an address in an <address> element', () => {
    expect(status(page('', '<address>1 Queen\'s Road, Central</address>'), 'address')).toBe('pass')
  })

  it('finds an about page from Chinese link text', () => {
    expect(status(page('', '<a href="/company">關於我們</a>'), 'about')).toBe('pass')
  })

  it('warns when only one of privacy and terms is linked', () => {
    expect(status(page('', '<a href="/privacy-policy">Privacy</a>'), 'policies')).toBe('warn')
    expect(status(page('', '<a href="/t">私隱政策</a><a href="/c">使用條款</a>'), 'policies')).toBe('pass')
  })

  it('warns on review markup that a search engine would reject', () => {
    expect(status(page(jsonLd({ '@type': 'Product', aggregateRating: { '@type': 'AggregateRating', ratingValue: 'great' } }), ''), 'reviews')).toBe('warn')
    expect(status(page(jsonLd({ '@type': 'Review', reviewRating: { '@type': 'Rating', ratingValue: 5 } }), ''), 'reviews')).toBe('pass')
  })

  it.each([
    ['a <time datetime>', page('', '<time datetime="2026-09-01">1 Sep</time>')],
    ['article meta', page('<meta property="article:modified_time" content="2026-09-01T00:00:00Z">', '')],
  ])('finds a visible date from %s', (_label, html) => {
    expect(status(html, 'dates')).toBe('pass')
  })

  it('fails HTTPS for a plain-HTTP page', () => {
    expect(status(RICH, 'https', 'http://example.com/')).toBe('fail')
  })

  it('ignores malformed JSON-LD instead of throwing', () => {
    expect(() => assessTrustSignals(page('<script type="application/ld+json">{not json</script>', ''), 'https://example.com/')).not.toThrow()
  })

  it('does not read signals out of comments or inline scripts', () => {
    const hidden = page('<script>var x = "<a href=\\"/privacy\\">Privacy</a><address>x</address>"</script>', '<!-- <a href="/about">About</a> -->')
    expect(status(hidden, 'policies')).toBe('fail')
    expect(status(hidden, 'address')).toBe('fail')
    expect(status(hidden, 'about')).toBe('fail')
  })
})
