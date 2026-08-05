import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkTopicalAuthority } from '@/lib/checks/topicalAuthority'
import { callOpenRouter } from '@/lib/openrouter'

// Previously unmocked, so this file made a real OpenRouter call on every run —
// slow, flaky, and billable.
vi.mock('@/lib/openrouter', () => ({ callOpenRouter: vi.fn() }))

const openRouter = vi.mocked(callOpenRouter)
const URLS = [
  'https://example.com/seo/guide',
  'https://example.com/seo/tools',
  'https://example.com/about',
]

beforeEach(() => {
  openRouter.mockReset()
  openRouter.mockResolvedValue('[]')
})

describe('checkTopicalAuthority', () => {
  it('returns warn for an empty sitemap', async () => {
    const r = await checkTopicalAuthority([], 'client-123', 'technology')

    expect(r.status).toBe('warn')
    expect(r.message).toBe('topical_authority_no_sitemap')
    expect(openRouter).not.toHaveBeenCalled()
  })

  it('returns a detectedClusters array for a usable sitemap', async () => {
    const r = await checkTopicalAuthority(URLS, 'client-123', 'technology')

    expect(r.geoDetails).toHaveProperty('detectedClusters')
    expect(Array.isArray(r.geoDetails?.detectedClusters)).toBe(true)
  })

  it.each([
    ['a bare string', 'https://example.com/x'],
    ['undefined', undefined],
    ['an object', {}],
  ])('degrades rather than throwing when handed %s', async (_label, input) => {
    // The regression: the route cast the request body straight to string[], so
    // a bare string reached .filter() here and threw a TypeError, which the
    // route reported as its own 'check_error' — a message a check must never
    // produce.
    const r = await checkTopicalAuthority(input, 'client-123', 'technology')

    expect(r.status).toBe('warn')
    expect(r.message).toBe('topical_authority_no_sitemap')
  })

  it('does not spend an LLM call on unusable input', async () => {
    // The call used to happen before the throw, so malformed input still cost
    // money on a route anonymous callers can reach.
    await checkTopicalAuthority('https://example.com/x', 'client-123', 'technology')

    expect(openRouter).not.toHaveBeenCalled()
  })

  it('marks the URL groups as untrusted data in the prompt', async () => {
    await checkTopicalAuthority(URLS, 'client-123', 'technology')

    const messages = openRouter.mock.calls[0][0].messages
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toMatch(/untrusted/i)
  })

  it('bounds the LLM call with a timeout', async () => {
    await checkTopicalAuthority(URLS, 'client-123', 'technology')

    expect(openRouter.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
  })

  it('coerces and truncates a hostile model response instead of storing it raw', async () => {
    // Whatever comes back is persisted into scans.results JSONB and rendered.
    openRouter.mockResolvedValue(JSON.stringify([
      {
        topic: '<img src=x onerror=alert(1)>'.padEnd(500, '!'),
        pillarPageUrl: 42,
        pillarPageWordCount: 'not-a-number',
        clusterArticles: 'not-an-array',
        interlinkCount: null,
        completenessScore: 70,
        unexpectedKey: 'dropped',
      },
      ...Array.from({ length: 9 }, () => ({ topic: 'filler' })),
    ]))

    const r = await checkTopicalAuthority(URLS, 'client-123', 'technology')
    const clusters = r.geoDetails!.detectedClusters

    expect(clusters).toHaveLength(5)
    const [first] = clusters
    expect(first.topic.length).toBeLessThanOrEqual(300)
    expect(first).not.toHaveProperty('unexpectedKey')
    expect(first.pillarPageUrl).toBe('')
    expect(first.pillarPageWordCount).toBe(0)
    expect(first.clusterArticles).toEqual([])
    expect(first.interlinkCount).toBe(0)
    expect(first.completenessScore).toBe(70)
  })

  it('survives a model response that is not JSON at all', async () => {
    openRouter.mockResolvedValue('I cannot help with that.')

    const r = await checkTopicalAuthority(URLS, 'client-123', 'technology')

    expect(r.geoDetails?.detectedClusters).toEqual([])
  })
})
