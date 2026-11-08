import { describe, expect, it, vi } from 'vitest'
import { checkPublicHomepage, parseDomainCheckInput } from '@/lib/domain-check/check'

describe('parseDomainCheckInput', () => {
  it('normalises any entered form to the public homepage origin', () => {
    expect(parseDomainCheckInput({ url: 'https://www.Example.com/path?q=1#x' }))
      .toEqual({ url: 'https://www.example.com/' })
  })
  it('accepts a bare domain', () => {
    expect(parseDomainCheckInput({ url: 'example.com' }).url).toBe('https://example.com/')
  })
  it.each([
    null, [], {}, { url: '' }, { url: 42 }, { url: `https://example.com/${'x'.repeat(2048)}` },
    { url: 'http://localhost' }, { url: 'https://127.0.0.1' },
    { url: 'https://user:pass@example.com' }, { url: 'https://example.com:8443' },
  ])('rejects %j', raw => expect(() => parseDomainCheckInput(raw)).toThrow())
})

describe('checkPublicHomepage', () => {
  const page = (html: string, status = 200, type = 'text/html; charset=utf-8') =>
    new Response(html, { status, headers: { 'content-type': type } })

  it('reports a live homepage and its collapsed title', async () => {
    const fetchPage = vi.fn(async () => page('<html><head><title>  Example   Domain </title></head></html>'))
    expect(await checkPublicHomepage({ url: 'https://www.example.com/' }, { fetchPage }))
      .toEqual({ status: 'live', domain: 'example.com', pageTitle: 'Example Domain' })
  })
  it('treats a non-2xx answer as unreachable', async () => {
    const fetchPage = vi.fn(async () => page('missing', 404))
    expect(await checkPublicHomepage({ url: 'https://example.com/' }, { fetchPage }))
      .toEqual({ status: 'unreachable', domain: 'example.com', pageTitle: null })
  })
  it('is live without a title when the page is not HTML', async () => {
    const fetchPage = vi.fn(async () => page('{}', 200, 'application/json'))
    expect(await checkPublicHomepage({ url: 'https://example.com/' }, { fetchPage }))
      .toEqual({ status: 'live', domain: 'example.com', pageTitle: null })
  })
  it('caps a long title', async () => {
    const fetchPage = vi.fn(async () => page(`<title>${'x'.repeat(300)}</title>`))
    expect((await checkPublicHomepage({ url: 'https://example.com/' }, { fetchPage })).pageTitle).toHaveLength(120)
  })
})
