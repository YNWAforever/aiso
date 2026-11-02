import { describe, expect, it, vi } from 'vitest'
import { FirecrawlError } from '@/lib/integrations/firecrawl/types'
import {
  STUDIO_FIRECRAWL_EXCERPT_LIMIT,
  queryStudioFirecrawl,
  type StudioFirecrawlDeps,
} from '@/lib/conversation-studio/firecrawl-query'

vi.mock('server-only', () => ({}))

function deps(overrides: Partial<StudioFirecrawlDeps> = {}): StudioFirecrawlDeps {
  return {
    credentials: vi.fn().mockReturnValue({ apiKey: 'fixture-key' }),
    isEnabled: vi.fn().mockResolvedValue(true),
    scrape: vi.fn().mockResolvedValue({
      url: 'https://example.com/article',
      title: 'Example page',
      markdown: 'Readable page body.',
      contentType: 'text/html',
    }),
    ...overrides,
  }
}

const input = { accountId: 'account-a', clientId: 'client-a', url: 'https://example.com/article' }

describe('queryStudioFirecrawl', () => {
  it('checks credentials, the brand switch and makes exactly one scrape', async () => {
    const d = deps()
    const snapshot = await queryStudioFirecrawl(input, d)
    expect(snapshot).toEqual({
      status: 'ok',
      url: 'https://example.com/article',
      title: 'Example page',
      excerpt: 'Readable page body.',
      contentType: 'text/html',
    })
    expect(d.isEnabled).toHaveBeenCalledWith('account-a', 'client-a')
    expect(d.scrape).toHaveBeenCalledTimes(1)
    expect(d.scrape).toHaveBeenCalledWith({ url: 'https://example.com/article' })
  })

  it('returns disconnected before settings or network when the key is absent', async () => {
    const d = deps({ credentials: vi.fn().mockReturnValue(null) })
    expect(await queryStudioFirecrawl(input, d)).toEqual({ status: 'disconnected' })
    expect(d.isEnabled).not.toHaveBeenCalled()
    expect(d.scrape).not.toHaveBeenCalled()
  })

  it('returns disabled before the vendor call', async () => {
    const d = deps({ isEnabled: vi.fn().mockResolvedValue(false) })
    expect(await queryStudioFirecrawl(input, d)).toEqual({ status: 'disabled', url: 'https://example.com/article' })
    expect(d.scrape).not.toHaveBeenCalled()
  })

  it.each([
    [undefined, 'firecrawl.emptyUrl'],
    ['   ', 'firecrawl.emptyUrl'],
    ['not a url', 'firecrawl.invalidUrl'],
    [`https://example.com/${'x'.repeat(2100)}`, 'firecrawl.urlTooLong'],
    ['file:///etc/passwd', 'firecrawl.publicOnly'],
    ['http://localhost/a', 'firecrawl.publicOnly'],
    ['http://127.0.0.1/a', 'firecrawl.publicOnly'],
    ['http://10.0.0.1/a', 'firecrawl.publicOnly'],
    ['http://user:fixture@example.com/a', 'firecrawl.publicOnly'],
  ])('refuses %s before settings or network', async (url, messageKey) => {
    const d = deps()
    expect(await queryStudioFirecrawl({ ...input, url }, d)).toEqual({ status: 'invalid', messageKey })
    expect(d.isEnabled).not.toHaveBeenCalled()
    expect(d.scrape).not.toHaveBeenCalled()
  })

  it('returns empty when the vendor has no readable body', async () => {
    const d = deps({ scrape: vi.fn().mockResolvedValue({ url: 'https://example.com/article', title: 'Example page' }) })
    expect(await queryStudioFirecrawl(input, d)).toMatchObject({ status: 'empty', url: 'https://example.com/article', title: 'Example page' })
    expect((await queryStudioFirecrawl(input, d)).excerpt).toBeUndefined()
  })

  it('truncates the excerpt to the documented cap', async () => {
    const d = deps({ scrape: vi.fn().mockResolvedValue({ url: 'https://example.com/a', markdown: 'x'.repeat(STUDIO_FIRECRAWL_EXCERPT_LIMIT + 50) }) })
    const snapshot = await queryStudioFirecrawl(input, d)
    expect(snapshot.status).toBe('ok')
    expect(snapshot.excerpt).toHaveLength(STUDIO_FIRECRAWL_EXCERPT_LIMIT)
  })

  it('falls back to text when markdown is absent', async () => {
    const d = deps({ scrape: vi.fn().mockResolvedValue({ url: 'https://example.com/a', text: 'Plain body' }) })
    expect(await queryStudioFirecrawl(input, d)).toMatchObject({ status: 'ok', excerpt: 'Plain body' })
  })

  it.each(['auth', 'payment', 'rate_limit', 'invalid', 'unavailable', 'misconfigured'] as const)(
    'maps a %s failure without a page body',
    async kind => {
      const d = deps({ scrape: vi.fn().mockRejectedValue(new FirecrawlError(kind, 500, 'vendor')) })
      const snapshot = await queryStudioFirecrawl(input, d)
      expect(snapshot).toEqual({ status: kind, url: 'https://example.com/article' })
      expect(snapshot.excerpt).toBeUndefined()
      expect(d.scrape).toHaveBeenCalledTimes(1)
    },
  )

  it('maps an unexpected failure to unavailable without inventing a body', async () => {
    const d = deps({ scrape: vi.fn().mockRejectedValue(new Error('private vendor error')) })
    expect(await queryStudioFirecrawl(input, d)).toEqual({ status: 'unavailable', url: 'https://example.com/article' })
  })
})
