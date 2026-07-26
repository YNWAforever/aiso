/**
 * Fix-pack routes: pure helpers + the auth/ownership gate.
 * All four /api/fix/* routes call OpenRouter, so an anonymous caller must be
 * rejected before any LLM spend happens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const supabaseQuery = () => {
  const q: Record<string, unknown> = {}
  q.select      = vi.fn(() => q)
  q.eq          = vi.fn(() => q)
  q.insert      = vi.fn(() => q)
  q.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  q.single      = vi.fn(async () => ({
    data: {
      id: 'scan-1', url: 'https://example.com', domain: 'example.com',
      results: { c2_llms_txt: { status: 'fail', message: 'llms_txt_missing' } },
    },
    error: null,
  }))
  return q
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => supabaseQuery()) },
  createServerSupabaseClient: vi.fn(() => ({ from: vi.fn(() => supabaseQuery()) })),
}))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getProfile: vi.fn(),
}))

// Tagged-template SQL mock — db() returns the template function itself
const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  db: () => sqlMock,
}))

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  text: async () => '<title>Example</title>',
}))

import { parseFixPack } from '@/app/api/fix/route'
import { getProfile } from '@/lib/auth'
import { callOpenRouter } from '@/lib/openrouter'

const PROFILE = { id: 'profile-1', account_id: 'acc-1', is_admin: false }

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  sqlMock.mockResolvedValue([])
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
    sqlMock.mockResolvedValue([])
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', { scanId: 'scan-other' }))

    expect(res.status).toBe(404)
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('scopes the ownership query to the caller account and allows anonymous scans', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    sqlMock.mockResolvedValue([{ id: 'scan-1' }])
    const { POST } = await import('@/app/api/fix/route')

    await POST(post('/api/fix', { scanId: 'scan-1' }))

    expect(sqlMock).toHaveBeenCalledTimes(1)
    const [strings, ...params] = sqlMock.mock.calls[0]
    const query = (strings as string[]).join('?')
    expect(query).toMatch(/from scans/i)
    expect(query).toMatch(/account_id is null or account_id = \?/i)
    expect(params).toEqual(['scan-1', 'acc-1'])
  })

  it('generates the fix pack for an owned scan', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    sqlMock.mockResolvedValue([{ id: 'scan-1' }])
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', { scanId: 'scan-1' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ llms_txt: '# About', robots_patch: 'Allow: /', faq_schema: '{}' })
    expect(callOpenRouter).toHaveBeenCalledTimes(1)
  })

  it('returns 400 for a missing scanId without touching the DB', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    const { POST } = await import('@/app/api/fix/route')

    const res = await POST(post('/api/fix', {}))

    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
    expect(callOpenRouter).not.toHaveBeenCalled()
  })
})

// Fenced during the Supabase to Neon migration — see lib/unavailable.ts and
// __tests__/api/fenced-routes.test.ts for the full fenced-route contract.
describe('POST /api/fix/cluster-map', () => {
  it('returns 503 FEATURE_UNAVAILABLE and never calls OpenRouter', async () => {
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'FEATURE_UNAVAILABLE', feature: 'content-tools' })
    expect(callOpenRouter).not.toHaveBeenCalled()
  })
})

describe('POST /api/fix/content-brief', () => {
  it('returns 503 FEATURE_UNAVAILABLE and never calls OpenRouter', async () => {
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'FEATURE_UNAVAILABLE', feature: 'content-tools' })
    expect(callOpenRouter).not.toHaveBeenCalled()
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
