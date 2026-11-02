import { describe, expect, it, vi } from 'vitest'
import { FirecrawlError } from '@/lib/integrations/firecrawl/types'
import {
  FIRECRAWL_EXCERPT_MAX,
  boundedExcerpt,
  queryStudioFirecrawl,
  type StudioFirecrawlDeps,
} from '@/lib/conversation-studio/firecrawl-query'
import { FIRECRAWL_URL_MAX, extractTurnUrl } from '@/lib/conversation-studio/firecrawl-url'

vi.mock('server-only', () => ({}))

function deps(overrides: Partial<StudioFirecrawlDeps> = {}): StudioFirecrawlDeps {
  return {
    config: vi.fn().mockReturnValue({ apiKey: 'x' }),
    isEnabled: vi.fn().mockResolvedValue(true),
    lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
    scrape: vi.fn().mockResolvedValue({
      url: 'https://example.com/a', title: 'Example page', markdown: '# Example\n\nBody text', contentType: 'text/html', pageStatus: 200,
    }),
    ...overrides,
  }
}

const input = { accountId: 'account-a', clientId: 'client-a', url: 'https://example.com/a' }

function expectNoVendor(d: StudioFirecrawlDeps) {
  expect(d.scrape).not.toHaveBeenCalled()
}

describe('extractTurnUrl', () => {
  it.each([
    ['Check https://example.com/a please', 'https://example.com/a'],
    ['See (https://example.com/a).', 'https://example.com/a'],
    ['請看https://example.com/頁面，謝謝', 'https://example.com/頁面'],
    ['first http://a.example/x then https://b.example/y', 'http://a.example/x'],
    ['no url here', null],
    ['ftp://example.com/file', null],
    ['https://', null],
  ])('extracts %j as %j', (prompt, url) => {
    expect(extractTurnUrl(prompt)).toBe(url)
  })
})

describe('boundedExcerpt', () => {
  it('drops images, collapses blank runs and caps without splitting characters', () => {
    expect(boundedExcerpt('![logo](https://x/y.png)\n\n\n\nHello\r\nWorld')).toBe('Hello\nWorld')
    const long = '香'.repeat(FIRECRAWL_EXCERPT_MAX + 50)
    const excerpt = boundedExcerpt(long)!
    expect(Array.from(excerpt)).toHaveLength(FIRECRAWL_EXCERPT_MAX + 1)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(boundedExcerpt('   ')).toBeUndefined()
  })
})

describe('queryStudioFirecrawl', () => {
  it('makes exactly one scrape and returns a bounded snapshot', async () => {
    const d = deps()
    const snapshot = await queryStudioFirecrawl(input, d)
    expect(snapshot).toEqual({
      status: 'ok', url: 'https://example.com/a', title: 'Example page',
      excerpt: '# Example\n\nBody text', contentType: 'text/html',
    })
    expect(d.isEnabled).toHaveBeenCalledWith('account-a', 'client-a')
    expect(d.lookup).toHaveBeenCalledWith('example.com')
    expect(d.scrape).toHaveBeenCalledTimes(1)
    expect(d.scrape).toHaveBeenCalledWith({ url: 'https://example.com/a' })
  })

  it('is disconnected with no settings read, lookup or vendor call when the key is missing', async () => {
    const d = deps({ config: vi.fn().mockReturnValue(null) })
    expect(await queryStudioFirecrawl(input, d)).toEqual({ status: 'disconnected', messageKey: 'firecrawl.disconnected' })
    expect(d.isEnabled).not.toHaveBeenCalled()
    expect(d.lookup).not.toHaveBeenCalled()
    expectNoVendor(d)
  })

  it('is disabled with no lookup or vendor call when the brand switch is off', async () => {
    const d = deps({ isEnabled: vi.fn().mockResolvedValue(false) })
    expect(await queryStudioFirecrawl(input, d)).toMatchObject({ status: 'disabled', url: 'https://example.com/a' })
    expect(d.lookup).not.toHaveBeenCalled()
    expectNoVendor(d)
  })

  it.each([
    ['', 'firecrawl.noUrl'],
    ['   ', 'firecrawl.noUrl'],
    [`https://example.com/${'a'.repeat(FIRECRAWL_URL_MAX)}`, 'firecrawl.urlTooLong'],
    ['file:///etc/passwd', 'firecrawl.urlNotPublic'],
    ['javascript:alert(1)', 'firecrawl.urlNotPublic'],
    ['ftp://example.com/a', 'firecrawl.urlNotPublic'],
    ['https://user:pass@example.com/', 'firecrawl.urlNotPublic'],
    ['http://localhost:3000/', 'firecrawl.urlNotPublic'],
    ['http://api.localhost/', 'firecrawl.urlNotPublic'],
    ['http://127.0.0.1/', 'firecrawl.urlNotPublic'],
    ['http://10.0.0.5/', 'firecrawl.urlNotPublic'],
    ['http://169.254.169.254/latest/meta-data', 'firecrawl.urlNotPublic'],
    ['http://[::1]/', 'firecrawl.urlNotPublic'],
    ['not a url', 'firecrawl.urlNotPublic'],
  ])('refuses %j as invalid before settings or network', async (url, messageKey) => {
    const d = deps()
    const snapshot = await queryStudioFirecrawl({ ...input, url }, d)
    expect(snapshot).toMatchObject({ status: 'invalid', messageKey })
    expect(snapshot.excerpt).toBeUndefined()
    expect(d.isEnabled).not.toHaveBeenCalled()
    expectNoVendor(d)
  })

  it('refuses a hostname that resolves to a private address', async () => {
    const d = deps({ lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.1.2.3', family: 4 }]) })
    expect(await queryStudioFirecrawl(input, d)).toMatchObject({ status: 'invalid', messageKey: 'firecrawl.urlNotPublic' })
    expectNoVendor(d)
  })

  it('refuses a hostname that does not resolve', async () => {
    const d = deps({ lookup: vi.fn().mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })) })
    expect(await queryStudioFirecrawl(input, d)).toMatchObject({ status: 'invalid', messageKey: 'firecrawl.urlUnresolved' })
    expectNoVendor(d)
  })

  it('accepts a public IP literal without a lookup', async () => {
    const d = deps()
    expect((await queryStudioFirecrawl({ ...input, url: 'http://93.184.216.34/' }, d)).status).toBe('ok')
    expect(d.lookup).not.toHaveBeenCalled()
    expect(d.scrape).toHaveBeenCalledTimes(1)
  })

  it('returns empty, not invented content, for an OK scrape with no markdown', async () => {
    const d = deps({ scrape: vi.fn().mockResolvedValue({ url: 'https://example.com/a', pageStatus: 200 }) })
    const snapshot = await queryStudioFirecrawl(input, d)
    expect(snapshot).toMatchObject({ status: 'empty', messageKey: 'firecrawl.empty' })
    expect(snapshot.excerpt).toBeUndefined()
  })

  it('does not present an error page body as page content', async () => {
    const d = deps({ scrape: vi.fn().mockResolvedValue({ url: 'https://example.com/a', title: 'Not Found', markdown: '404 page', pageStatus: 404 }) })
    const snapshot = await queryStudioFirecrawl(input, d)
    expect(snapshot).toMatchObject({ status: 'empty', messageKey: 'firecrawl.pageError', url: 'https://example.com/a' })
    expect(snapshot.excerpt).toBeUndefined()
    expect(snapshot.title).toBeUndefined()
  })

  it.each(['auth', 'payment', 'rate_limit', 'invalid', 'unavailable', 'misconfigured'] as const)(
    'maps a %s failure after one attempt without content',
    async kind => {
      const d = deps({ scrape: vi.fn().mockRejectedValue(new FirecrawlError(kind, 500, 'vendor')) })
      const snapshot = await queryStudioFirecrawl(input, d)
      expect(snapshot).toEqual({ status: kind, url: 'https://example.com/a', messageKey: `firecrawl.${kind}` })
      expect(d.scrape).toHaveBeenCalledTimes(1)
    },
  )

  it('maps an unexpected scrape error to unavailable', async () => {
    const d = deps({ scrape: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await queryStudioFirecrawl(input, d)).toMatchObject({ status: 'unavailable' })
    expect(d.scrape).toHaveBeenCalledTimes(1)
  })
})
