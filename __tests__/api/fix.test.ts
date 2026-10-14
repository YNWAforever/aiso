/**
 * Fix-pack routes: pure helpers + the auth/ownership gate.
 * All four /api/fix/* routes call OpenRouter, so an anonymous caller must be
 * rejected before any LLM spend happens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Tagged-template SQL mock — db() returns the template function itself.
// Queries are queued in call order: ownership check, cache read, scan read,
// cache write.
const queries: string[] = []
let nextResults: unknown[][] = []

const sqlMock = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) return Promise.reject(result)
  return Promise.resolve(result ?? [])
})

vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getProfile: vi.fn(),
}))
vi.mock('@/lib/security/public-url', () => ({ fetchPublicUrl: vi.fn() }))

// These routes now spend a per-account daily allowance before any model call
// (lib/fix/guard.ts). The counter is out of scope here — always allowed — and
// is exercised in content-tools-gate.test.ts.
vi.mock('@/lib/security/durable-rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/security/durable-rate-limit')>()),
  consumeFromNeon: vi.fn(async () => ({ allowed: true, remaining: 19, resetAt: 2_000_000_000 })),
  resolveRateLimitSecret: () => 'x'.repeat(32),
}))

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  text: async () => '<title>Example</title>',
}))

import { parseFixPack } from '@/app/api/fix/route'
import { getProfile } from '@/lib/auth'
import { callOpenRouter } from '@/lib/openrouter'
import { fetchPublicUrl } from '@/lib/security/public-url'

const GROUNDED_PACK = {
  llms_txt: '# example.com\n\n> Review draft. Source quotes are not independently verified.\n\n## Observed source\n- Origin: https://example.com\n- Page title (source quote): "Example"\n\n## Evidence limits\n- Site sections and business policies were not verified.\n- No supported FAQ pairs were found. The FAQ draft is empty and must not be published as a completed FAQ.',
  robots_patch: '# REVIEW REQUIRED: crawler access and training policies were not supplied.\n# No access directives generated. Confirm your policy before editing robots.txt.',
  faq_schema: '{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": []\n}',
}

// A paid account: the content tools are refused to free, cancelled and
// expired-trial accounts (content-tools-gate.test.ts covers those).
const PROFILE = {
  id: 'profile-1', account_id: 'acc-1', is_admin: false,
  accounts: {
    plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1',
    trial_ends_at: null, override_plan: null, override_expires_at: null,
  },
}

const SCAN_ROW = {
  id: 'scan-1', url: 'https://example.com', domain: 'example.com',
  results: { c2_llms_txt: { status: 'fail', message: 'llms_txt_missing' } },
}

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  queries.length = 0
  nextResults = []
  vi.mocked(fetchPublicUrl).mockResolvedValue(new Response('<title>Example</title>'))
  vi.mocked(callOpenRouter).mockResolvedValue(
    '{"llms_txt":"# About","robots_patch":"Allow: /","faq_schema":"{}"}'
  )
})

describe('parseFixPack', () => {
  it('extracts JSON from LLM response with leading text', () => {
    const raw = 'Here is the fix: {"llms_txt":"hello","robots_patch":"x","faq_schema":"y"}'
    expect(parseFixPack(raw)).toEqual({ llms_txt: 'hello', robots_patch: 'x', faq_schema: 'y' })
  })

  it('handles clean JSON response', () => {
    const raw = '{"llms_txt":"a","robots_patch":"b","faq_schema":"c"}'
    expect(parseFixPack(raw)).toEqual({ llms_txt: 'a', robots_patch: 'b', faq_schema: 'c' })
  })
})

describe('POST /api/fix', () => {
  it('copies only FAQ pairs corroborated by page text and ignores hidden-only schema claims', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    const faq = { '@type': 'FAQPage', mainEntity: [
      { '@type': 'Question', name: 'What is this page?', acceptedAnswer: { '@type': 'Answer', text: 'A published example.' } },
      { '@type': 'Question', name: 'Is training permitted?', acceptedAnswer: { '@type': 'Answer', text: 'Yes, everything is permitted.' } },
    ] }
    vi.mocked(fetchPublicUrl).mockResolvedValue(new Response('<h1>What is this page?</h1><p>A published example.</p><script type="application/ld+json">' + JSON.stringify(faq) + '</script>'))
    nextResults = [[{ id: 'scan-1' }], [], [SCAN_ROW], []]
    const { POST } = await import('@/app/api/fix/route')
    const response = await POST(post('/api/fix', { scanId: 'scan-1' }))
    const pack = await response.json()
    expect(response.status).toBe(200)
    expect(JSON.parse(pack.faq_schema).mainEntity).toEqual([
      { '@type': 'Question', name: 'What is this page?', acceptedAnswer: { '@type': 'Answer', text: 'A published example.' } },
    ])
    expect(pack.faq_schema).not.toContain('training')
    expect(callOpenRouter).not.toHaveBeenCalled()
  })
  it('labels failed page fetch as missing evidence without copying an error page', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    vi.mocked(fetchPublicUrl).mockResolvedValue(new Response('<title>Secret admin policy</title>', { status: 503 }))
    nextResults = [[{ id: 'scan-1' }], [], [SCAN_ROW], []]
    const { POST } = await import('@/app/api/fix/route')
    const response = await POST(post('/api/fix', { scanId: 'scan-1' }))
    const pack = await response.json()
    expect(pack.llms_txt).toContain('Page content could not be fetched')
    expect(pack.llms_txt).not.toContain('Secret admin policy')
    expect(JSON.parse(pack.faq_schema).mainEntity).toEqual([])
    expect(pack.robots_patch).not.toMatch(/^(Allow|Disallow):/m)
  })
  it('does not turn a bare page title into invented pages, policies or FAQ claims', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[{ id: 'scan-1' }], [], [SCAN_ROW], []]
    const { POST } = await import('@/app/api/fix/route')
    const res = await POST(post('/api/fix', { scanId: 'scan-1' }))
    const pack = await res.json()
    expect(res.status).toBe(200)
    expect(pack.llms_txt).toContain('https://example.com')
    expect(pack.llms_txt).not.toMatch(/\/about|\/faq|Last Updated|2024/)
    expect(pack.robots_patch).not.toMatch(/^(?:Allow|Disallow|Sitemap|User-agent):/m)
    expect(JSON.parse(pack.faq_schema).mainEntity).toEqual([])
  })
  it('does not replay an ungrounded legacy cache', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[{ id: 'scan-1' }], [{ llms_txt: '# Invented 2024 policy', robots_patch: 'Allow: /', faq_schema: '{}' }], [SCAN_ROW], []]
    const { POST } = await import('@/app/api/fix/route')
    const res = await POST(post('/api/fix', { scanId: 'scan-1' }))
    const pack = await res.json()
    expect(res.status).toBe(200)
    expect(pack.llms_txt).not.toContain('Invented 2024 policy')
    expect(pack.robots_patch).not.toMatch(/^Allow:/m)
    expect(JSON.parse(pack.faq_schema).mainEntity).toEqual([])
  })
  it('rejects an anonymous caller with 401 and never calls OpenRouter', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', { scanId: 'scan-1' }))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(callOpenRouter).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 404 (not 403) when the scan belongs to another account', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[]] // ownership check: no rows
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', { scanId: 'scan-other' }))

    expect(res.status).toBe(404)
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('scopes the ownership query to the caller account and allows anonymous scans', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[{ id: 'scan-1' }], [{ llms_txt: 'cached', robots_patch: 'x', faq_schema: 'y' }]]
    const { POST } = await import('@/app/api/fix/route')

    await POST(post('/api/fix', { scanId: 'scan-1' }))

    const query = queries[0]!
    expect(query).toMatch(/from scans/i)
    expect(query).toMatch(/account_id is null or account_id = \?/i)
    const [strings, ...params] = sqlMock.mock.calls[0]!
    void strings
    expect(params).toEqual(['scan-1', 'acc-1'])
  })

  it('reuses a source-matching grounded cache without a new cache write or model call', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'scan-1' }], // ownership check
      [GROUNDED_PACK], // grounded cache
      [SCAN_ROW], // recheck source evidence
    ]
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', { scanId: 'scan-1' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(GROUNDED_PACK)
    expect(callOpenRouter).not.toHaveBeenCalled()
    expect(queries).toHaveLength(3) // ownership + cache + owned scan; no insert
  })

  it('generates the fix pack for an owned scan on a cache miss', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'scan-1' }], // ownership check
      [], // cache miss
      [SCAN_ROW], // scan read
      [{ id: 'fp-1' }], // cache write
    ]
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', { scanId: 'scan-1' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(GROUNDED_PACK)
    expect(callOpenRouter).not.toHaveBeenCalled()
    expect(queries).toHaveLength(4)
    expect(queries[3]).toMatch(/insert into fix_packs/i)
  })

  it('returns 400 for a missing scanId without touching the DB', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', {}))

    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('returns 500 when the ownership check fails, not a silent success', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', { scanId: 'scan-1' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Database error' })
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('returns 500 when the cache/scan lookup fails, not a silent success', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'scan-1' }], // ownership check succeeds
      new Error('connection terminated') as never, // cache read fails
    ]
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', { scanId: 'scan-1' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Database error' })
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('still returns the generated fix pack when the cache write fails', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    nextResults = [
      [{ id: 'scan-1' }], // ownership check
      [], // cache miss
      [SCAN_ROW], // scan read
      new Error('connection terminated') as never, // cache write fails
    ]
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', { scanId: 'scan-1' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(GROUNDED_PACK)
    consoleError.mockRestore()
  })
})

// Restored from the Supabase-to-Neon fence (2026-08-23) — was
// featureUnavailable('content-tools'); see __tests__/api/fenced-routes.test.ts
// for the still-fenced routes and lib/unavailable.ts for the fence mechanism.
describe('POST /api/fix/cluster-map', () => {
  const CLUSTER_ROW = { topic: 'mortgage rates', pillar_page_url: 'https://example.com/mortgages', completeness_score: 0.6 }

  it('rejects an anonymous caller with 401 and never calls OpenRouter', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(401)
    expect(callOpenRouter).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a missing clientId or industry without touching the DB', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1' }))

    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 404 (not 403) when the client belongs to another account', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[]] // ownership check: no rows
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(404)
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('returns 500 when the ownership check fails, not a silent success', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Database error' })
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('returns 500 when the cluster lookup fails, not a silent success', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'client-1' }], // ownership check
      new Error('connection terminated') as never, // cluster lookup fails
    ]
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Database error' })
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('generates a cluster map for an owned client, scoped to that client', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'client-1' }], // ownership check
      [CLUSTER_ROW], // existing clusters
    ]
    vi.mocked(callOpenRouter).mockResolvedValue(
      '{"clientClusters":[],"recommendedNewClusters":[],"priorityOrder":[],"competitorGaps":[]}'
    )
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      clusterMap: { clientClusters: [], recommendedNewClusters: [], priorityOrder: [], competitorGaps: [] },
    })
    expect(callOpenRouter).toHaveBeenCalledTimes(1)
    const query = queries[1]!
    expect(query).toMatch(/from topical_clusters/i)
    const [, ...params] = sqlMock.mock.calls[1]!
    expect(params).toEqual(['client-1'])
  })

  it('returns 500 when the LLM response is not parseable JSON', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[{ id: 'client-1' }], []]
    vi.mocked(callOpenRouter).mockResolvedValue('not json at all')
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to parse LLM response' })
  })
})

describe('POST /api/fix/content-brief', () => {
  const BRIEF_JSON = '{"titleSuggestions":["A"],"sections":[],"requiredOriginalDataPoints":[],"suggestedFaq":[],"recommendedSchema":{"@type":"Article"},"chunkabilityRequirements":{"idealChunkLength":"600-1000 tokens","answerFirst":true,"selfContained":true}}'

  it('rejects an anonymous caller with 401 and never calls OpenRouter', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(401)
    expect(callOpenRouter).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 400 for missing required fields without touching the DB', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1' }))

    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 404 (not 403) when the client belongs to another account', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[]]
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(404)
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('returns 500 when the ownership check fails, not a silent success', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Database error' })
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('generates a content brief and persists it with the industry authority domains', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'client-1' }], // ownership check
      [{ id: 'brief-1' }], // insert
    ]
    vi.mocked(callOpenRouter).mockResolvedValue(BRIEF_JSON)
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('brief-1')
    expect(body.brief.targetTopic).toBe('mortgage rates')
    expect(body.brief.titleSuggestions).toEqual(['A'])
    expect(body.brief.requiredAuthorities.length).toBeGreaterThan(0)
    expect(callOpenRouter).toHaveBeenCalledTimes(1)
    const query = queries[1]!
    expect(query).toMatch(/insert into content_briefs/i)
  })

  it('returns 500 when the LLM response is not parseable JSON', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[{ id: 'client-1' }]]
    vi.mocked(callOpenRouter).mockResolvedValue('not json at all')
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to parse LLM response' })
    expect(sqlMock).toHaveBeenCalledTimes(1) // ownership check only, no insert attempted
  })

  it('returns 500 when the content_briefs insert fails, not a response with a missing id', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'client-1' }], // ownership check
      new Error('connection terminated') as never, // insert fails
    ]
    vi.mocked(callOpenRouter).mockResolvedValue(BRIEF_JSON)
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Database error' })
  })
})

describe('POST /api/fix/rewrite-chunks', () => {
  it('rejects an anonymous caller with 401 and never calls OpenRouter', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)
    const { POST } = await import('@/app/api/fix/rewrite-chunks/route')

    const res = await POST(post('/api/fix/rewrite-chunks', { chunkText: 'hello world' }))

    expect(res.status).toBe(401)
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('rewrites the chunk for a signed-in caller', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    vi.mocked(callOpenRouter).mockResolvedValue('{"rewritten":"better text","changes":["x"]}')
    const { POST } = await import('@/app/api/fix/rewrite-chunks/route')

    const res = await POST(post('/api/fix/rewrite-chunks', { chunkText: 'hello world' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rewritten: 'better text', changes: ['x'] })
  })
})
