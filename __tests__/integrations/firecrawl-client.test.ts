import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIRECRAWL_SCRAPE_URL,
  buildScrapeRequestBody,
  classifyFirecrawlFailure,
  firecrawlConfig,
  scrapePublicPage,
} from '@/lib/integrations/firecrawl/client'
import { FirecrawlError } from '@/lib/integrations/firecrawl/types'

vi.mock('server-only', () => ({}))

const env = { FIRECRAWL_API_KEY: 'UNIT_TEST_KEY' }

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.restoreAllMocks())

describe('firecrawlConfig', () => {
  it('reads only FIRECRAWL_API_KEY and treats blank as unavailable', () => {
    expect(firecrawlConfig(env)).toEqual({ apiKey: 'UNIT_TEST_KEY' })
    expect(firecrawlConfig({})).toBeNull()
    expect(firecrawlConfig({ FIRECRAWL_API_KEY: '   ' })).toBeNull()
  })
})

describe('buildScrapeRequestBody', () => {
  it('accepts exactly one URL', () => {
    expect(() => buildScrapeRequestBody([])).toThrow(FirecrawlError)
    expect(() => buildScrapeRequestBody(['https://a.example', 'https://b.example'])).toThrow(FirecrawlError)
  })

  it('requests markdown only, main content, basic proxy and no JSON format', () => {
    const body = buildScrapeRequestBody(['https://example.com/a'])
    expect(body).toEqual({
      url: 'https://example.com/a',
      formats: ['markdown'],
      onlyMainContent: true,
      proxy: 'basic',
      timeout: 12_000,
    })
    expect(JSON.stringify(body)).not.toMatch(/json|html|screenshot|actions|location/i)
  })
})

describe('scrapePublicPage', () => {
  it('POSTs one /v2/scrape request with a Bearer key and maps the page', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      success: true,
      data: {
        markdown: '# Example\n\nBody text',
        metadata: { title: 'Example page', url: 'https://example.com/a', sourceURL: 'https://example.com/a', statusCode: 200, contentType: 'text/html' },
      },
    }))
    const page = await scrapePublicPage({ url: 'https://example.com/a' }, { env, fetch: fetchImpl })
    expect(page).toEqual({
      url: 'https://example.com/a', title: 'Example page', markdown: '# Example\n\nBody text',
      contentType: 'text/html', pageStatus: 200,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(FIRECRAWL_SCRAPE_URL)
    expect(FIRECRAWL_SCRAPE_URL).toBe('https://api.firecrawl.dev/v2/scrape')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toMatch(/^Bearer \S+$/)
    expect(init.body).not.toContain('UNIT_TEST_KEY')
    expect(JSON.parse(init.body).url).toBe('https://example.com/a')
  })

  it('falls back to sourceURL and ignores non-http vendor URLs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      success: true,
      data: { markdown: 'x', metadata: { url: 'javascript:alert(1)', sourceURL: 'https://example.com/b', title: '  ' } },
    }))
    const page = await scrapePublicPage({ url: 'https://example.com/b' }, { env, fetch: fetchImpl })
    expect(page.url).toBe('https://example.com/b')
    expect(page.title).toBeUndefined()
  })

  it('does not fetch when the key is missing', async () => {
    const fetchImpl = vi.fn()
    await expect(scrapePublicPage({ url: 'https://example.com' }, { env: {}, fetch: fetchImpl }))
      .rejects.toMatchObject({ kind: 'misconfigured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'auth'], [402, 'payment'], [429, 'rate_limit'], [400, 'invalid'], [403, 'invalid'],
    [422, 'invalid'], [408, 'unavailable'], [500, 'unavailable'], [503, 'unavailable'],
  ] as const)('classifies HTTP %s as %s', (status, kind) => {
    expect(classifyFirecrawlFailure(status)).toBe(kind)
  })

  it('makes a single attempt on 408 and never logs the key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ success: false, error: 'timeout', details: { state: 'processing_continues' } }, 408))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(scrapePublicPage({ url: 'https://example.com' }, { env, fetch: fetchImpl }))
      .rejects.toMatchObject({ kind: 'unavailable', httpStatus: 408 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const logged = [...consoleError.mock.calls, ...consoleLog.mock.calls].flat().join(' ')
    expect(logged).not.toContain('UNIT_TEST_KEY')
  })

  it('maps transport failure to unavailable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network'))
    await expect(scrapePublicPage({ url: 'https://example.com' }, { env, fetch: fetchImpl }))
      .rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('treats success:false on HTTP 200 as unavailable without content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ success: false, error: 'x' }))
    await expect(scrapePublicPage({ url: 'https://example.com' }, { env, fetch: fetchImpl }))
      .rejects.toMatchObject({ kind: 'unavailable' })
  })
})
