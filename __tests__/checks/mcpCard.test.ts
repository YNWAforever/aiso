import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkMcpCard } from '@/lib/checks/mcpCard'
import { createPublicUrlFetcher } from '@/lib/security/public-url'
import { forbidGlobalFetch } from '../helpers/forbid-global-fetch'

const BARE_HTML = '<html><body><p>nothing to see</p></body></html>'
const AI_META_HTML = '<html><head><link rel="mcp" href="/mcp.json"></head><body></body></html>'

const notFound = () => Promise.resolve(new Response('Not Found', { status: 404 }))

beforeEach(() => {
  vi.restoreAllMocks()
  forbidGlobalFetch()
})

describe('checkMcpCard', () => {
  it('probes every well-known AI endpoint through the injected fetcher', async () => {
    const fetcher = vi.fn(notFound)

    await checkMcpCard('https://example.com', BARE_HTML, fetcher)

    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://example.com/.well-known/mcp.json',
      'https://example.com/.well-known/ai.json',
      'https://example.com/.well-known/openai.json',
      'https://example.com/ai-plugin.json',
    ])
  })

  it('never reaches for the global fetch', async () => {
    // The regression this file exists for: checkMcpCard used to call bare
    // fetch(), skipping the SSRF boundary every other check routes through.
    // forbidGlobalFetch() makes the global throw, so a relapse fails here.
    const fetcher = vi.fn(notFound)

    await expect(checkMcpCard('https://example.com', BARE_HTML, fetcher))
      .resolves.toMatchObject({ status: 'fail' })
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('resolves endpoints against the origin rather than concatenating', async () => {
    const fetcher = vi.fn(notFound)

    await checkMcpCard('https://example.com/en/', BARE_HTML, fetcher)

    // String concatenation produced 'https://example.com/en//.well-known/mcp.json'.
    for (const [url] of fetcher.mock.calls) {
      expect(url).not.toContain('//.well-known')
      expect(url).not.toContain('/en/')
    }
  })

  it('does not reach a link-local address behind a public hostname', async () => {
    // The real boundary, not a stub: the resolver answers with the cloud
    // metadata address, so the guard must refuse before any socket is opened.
    const fetcher = createPublicUrlFetcher({
      lookup: async () => [{ address: '169.254.169.254', family: 4 as const }],
    })

    const result = await checkMcpCard('https://metadata.example', BARE_HTML, fetcher)

    expect(result).toEqual({ status: 'fail', message: 'mcp_card_missing' })
  })

  it('passes when a well-known endpoint answers', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    const result = await checkMcpCard('https://example.com', BARE_HTML, fetcher)

    expect(result).toMatchObject({ status: 'pass', details: '/.well-known/mcp.json' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('warns when only AI meta tags are present', async () => {
    const result = await checkMcpCard('https://example.com', AI_META_HTML, vi.fn(notFound))

    expect(result).toEqual({ status: 'warn', message: 'mcp_card_meta_only' })
  })
})
