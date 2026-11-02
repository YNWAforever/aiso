import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIRECRAWL_MAX_URL_LENGTH,
  FIRECRAWL_SCRAPE_URL,
  FIRECRAWL_TIMEOUT_MS,
  buildScrapeRequestBody,
  classifyFirecrawlFailure,
  firecrawlConfig,
  normalizePublicScrapeUrl,
  scrapePublicPage,
} from '@/lib/integrations/firecrawl/client'
import { FirecrawlError } from '@/lib/integrations/firecrawl/types'

vi.mock('server-only', () => ({}))

const env = { FIRECRAWL_API_KEY: 'UNIT_TEST_FIRECRAWL_KEY' }
const input = { url: 'https://example.com/article' }

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.restoreAllMocks())

describe('firecrawlConfig', () => {
  it('uses only a non-blank FIRECRAWL_API_KEY', () => {
    expect(firecrawlConfig(env)).toEqual({ apiKey: 'UNIT_TEST_FIRECRAWL_KEY' })
    expect(firecrawlConfig({})).toBeNull()
    expect(firecrawlConfig({ FIRECRAWL_API_KEY: '   ' })).toBeNull()
  })
})

describe('normalizePublicScrapeUrl', () => {
  it('accepts public http(s) pages', () => {
    expect(normalizePublicScrapeUrl(' https://example.com/a ')).toEqual({ ok: true, url: 'https://example.com/a' })
    expect(normalizePublicScrapeUrl('http://example.org')).toEqual({ ok: true, url: 'http://example.org/' })
  })

  it.each([
    ['', 'empty'],
    ['not a url', 'invalid'],
    [`https://example.com/${'x'.repeat(FIRECRAWL_MAX_URL_LENGTH)}`, 'too_long'],
    ['file:///etc/passwd', 'not_public'],
    ['ftp://example.com/a', 'not_public'],
    ['http://localhost/a', 'not_public'],
    ['http://app.localhost/a', 'not_public'],
    ['http://printer.local/a', 'not_public'],
    ['http://127.0.0.1/a', 'not_public'],
    ['http://10.1.2.3/a', 'not_public'],
    ['http://172.20.0.1/a', 'not_public'],
    ['http://192.168.1.1/a', 'not_public'],
    ['http://169.254.169.254/latest', 'not_public'],
    ['http://[::1]/a', 'not_public'],
    ['http://[fd00::1]/a', 'not_public'],
    ['http://user:fixture@example.com/a', 'not_public'],
    ['http://intranet/a', 'not_public'],
  ] as const)('refuses %s as %s', (url, reason) => {
    expect(normalizePublicScrapeUrl(url)).toEqual({ ok: false, reason })
  })
})

describe('buildScrapeRequestBody', () => {
  it('builds exactly one URL and no crawl-shaped options', () => {
    expect(buildScrapeRequestBody('https://example.com/a')).toEqual({
      url: 'https://example.com/a',
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: FIRECRAWL_TIMEOUT_MS,
      removeBase64Images: true,
    })
    expect(FIRECRAWL_TIMEOUT_MS).toBeLessThanOrEqual(20_000)
  })

  it.each([
    [[]],
    [['https://example.com/a', 'https://example.com/b']],
    [{ urls: ['https://example.com/a'] }],
    [{ crawl: true, url: 'https://example.com/a' }],
    [null],
  ])('rejects the non-single-URL shape %j', shape => {
    expect(() => buildScrapeRequestBody(shape)).toThrow(FirecrawlError)
  })
})

describe('scrapePublicPage', () => {
  it('POSTs one URL with Bearer auth and parses only present fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      success: true,
      data: {
        markdown: '# Example page\n\nBody text.',
        metadata: {
          title: 'Example page',
          url: 'https://example.com/article',
          statusCode: 200,
          contentType: 'text/html',
        },
      },
    }))
    const result = await scrapePublicPage(input, env, fetchImpl)
    expect(result).toEqual({
      url: 'https://example.com/article',
      title: 'Example page',
      markdown: '# Example page\n\nBody text.',
      contentType: 'text/html',
      pageStatusCode: 200,
    })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(FIRECRAWL_SCRAPE_URL)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer UNIT_TEST_FIRECRAWL_KEY')
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      url: 'https://example.com/article',
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: FIRECRAWL_TIMEOUT_MS,
      removeBase64Images: true,
    })
    expect(init.body).not.toContain('UNIT_TEST_FIRECRAWL_KEY')
  })

  it('does not fetch without a key', async () => {
    const fetchImpl = vi.fn()
    await expect(scrapePublicPage(input, {}, fetchImpl)).rejects.toMatchObject({ kind: 'misconfigured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not fetch an invalid or private URL', async () => {
    const fetchImpl = vi.fn()
    await expect(scrapePublicPage({ url: 'http://127.0.0.1/a' }, env, fetchImpl)).rejects.toMatchObject({ kind: 'invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps a transport failure without logging the key', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(scrapePublicPage(input, env, fetchImpl)).rejects.toMatchObject({ kind: 'unavailable' })
    const logged = [...consoleError.mock.calls, ...consoleLog.mock.calls].flat().join(' ')
    expect(logged).not.toContain('UNIT_TEST_FIRECRAWL_KEY')
  })

  it.each([
    [401, undefined, 'auth'], [403, undefined, 'auth'], [402, undefined, 'payment'],
    [429, undefined, 'rate_limit'], [500, undefined, 'unavailable'], [503, undefined, 'unavailable'],
    [400, undefined, 'invalid'], [404, undefined, 'invalid'], [422, undefined, 'invalid'],
    [200, 'insufficient_credits', 'payment'], [200, 'rate_limit_exceeded', 'rate_limit'],
    [200, 'unauthorized', 'auth'], [200, 'SCRAPE_NO_CACHED_DATA', 'invalid'],
  ] as const)('classifies HTTP %s / detail %s as %s', (http, detail, kind) => {
    expect(classifyFirecrawlFailure(http, detail)).toBe(kind)
  })

  it('maps a vendor success:false payload to a typed failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ success: false, code: 'insufficient_credits' }, 200))
    await expect(scrapePublicPage(input, env, fetchImpl)).rejects.toMatchObject({ kind: 'payment', code: 'insufficient_credits' })
  })

  it('returns no body for an empty page and treats a page error as invalid', async () => {
    const empty = vi.fn().mockResolvedValue(response({ success: true, data: { metadata: { url: 'https://example.com/a' } } }))
    expect(await scrapePublicPage(input, env, empty)).toEqual({ url: 'https://example.com/a' })
    const failed = vi.fn().mockResolvedValue(response({ success: true, data: { metadata: { error: 'blocked' } } }))
    await expect(scrapePublicPage(input, env, failed)).rejects.toMatchObject({ kind: 'invalid' })
  })
})
