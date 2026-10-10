import { describe, it, expect, vi } from 'vitest'
import { fetchSitemapPageUrls } from '@/lib/sitemap-fetch'

const xml = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/xml' } })
const urlset = (...locs: string[]) => `<urlset>${locs.map(l => `<url><loc>${l}</loc></url>`).join('')}</urlset>`
const index = (...locs: string[]) => `<sitemapindex>${locs.map(l => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`

describe('fetchSitemapPageUrls', () => {
  it('returns the page URLs of a plain urlset', async () => {
    const fetcher = vi.fn(async () => xml(urlset('https://example.com/a/b', 'https://example.com/a/c')))

    expect(await fetchSitemapPageUrls(fetcher, 'https://example.com', { timeoutMs: 8_000 }))
      .toEqual(['https://example.com/a/b', 'https://example.com/a/c'])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('follows a sitemap index one level to page URLs', async () => {
    // The route used to hand c19 the index's own <loc>s — child .xml files —
    // so every site with a sitemap index looked like it had no topic structure.
    const fetcher = vi.fn(async (url: URL) => url.pathname === '/sitemap.xml'
      ? xml(index('https://example.com/sitemap-posts.xml', 'https://example.com/sitemap-pages.xml'))
      : xml(urlset('https://example.com/blog/one', 'https://example.com/blog/two')))

    expect(await fetchSitemapPageUrls(fetcher, 'https://example.com', { timeoutMs: 8_000 }))
      .toEqual(['https://example.com/blog/one', 'https://example.com/blog/two'])
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1][0])).toBe('https://example.com/sitemap-posts.xml')
  })

  it('never follows an index entry to another origin', async () => {
    const fetcher = vi.fn(async () => xml(index('https://elsewhere.example/sitemap.xml')))

    expect(await fetchSitemapPageUrls(fetcher, 'https://example.com', { timeoutMs: 8_000 })).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('returns nothing for a non-OK sitemap', async () => {
    const fetcher = vi.fn(async () => xml('not found', 404))

    expect(await fetchSitemapPageUrls(fetcher, 'https://example.com', { timeoutMs: 8_000 })).toEqual([])
  })

  it('caps the list at 200 URLs', async () => {
    const many = Array.from({ length: 250 }, (_, i) => `https://example.com/p/${i}`)
    const fetcher = vi.fn(async () => xml(urlset(...many)))

    expect(await fetchSitemapPageUrls(fetcher, 'https://example.com', { timeoutMs: 8_000 })).toHaveLength(200)
  })

  it('lets a failed root fetch throw so the caller can record it', async () => {
    const fetcher = vi.fn(async () => { throw new Error('network') })

    await expect(fetchSitemapPageUrls(fetcher, 'https://example.com', { timeoutMs: 8_000 })).rejects.toThrow('network')
  })
})
