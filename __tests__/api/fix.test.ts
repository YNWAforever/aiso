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

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  text: async () => '<title>Example</title>',
}))

import { parseFixPack } from '@/app/api/fix/route'
import { getProfile } from '@/lib/auth'
import { callOpenRouter } from '@/lib/openrouter'

const PROFILE = { id: 'profile-1', account_id: 'acc-1', is_admin: false }

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

  it('returns the cached fix pack without calling OpenRouter', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'scan-1' }], // ownership check
      [{ llms_txt: 'cached', robots_patch: 'cached-robots', faq_schema: 'cached-faq' }], // cache hit
    ]
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', { scanId: 'scan-1' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ llms_txt: 'cached', robots_patch: 'cached-robots', faq_schema: 'cached-faq' })
    expect(callOpenRouter).not.toHaveBeenCalled()
    expect(queries).toHaveLength(2) // ownership + cache read only, no scan read, no insert
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
    expect(await res.json()).toEqual({ llms_txt: '# About', robots_patch: 'Allow: /', faq_schema: '{}' })
    expect(callOpenRouter).toHaveBeenCalledTimes(1)
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
    expect(await res.json()).toEqual({ llms_txt: '# About', robots_patch: 'Allow: /', faq_schema: '{}' })
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
