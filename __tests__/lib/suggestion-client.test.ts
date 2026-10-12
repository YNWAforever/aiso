import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseQuestionSuggestions, saveSuggestedQuestion } from '@/lib/prompts/suggestion-client'

const input = { question: 'Can Acme help?', category: 'brand_query', language: 'en' as const, market: 'HK' }
const prompt = { ...input, id: 'saved-1', client_id: 'client-1', is_active: true, created_at: '2026-10-12T00:00:00Z' }
afterEach(() => vi.unstubAllGlobals())

describe('suggestion response validation', () => {
  it('keeps editable suggestions only in the requested context', () => {
    expect(parseQuestionSuggestions({ suggestions: [input] }, input)).toEqual([input])
    expect(parseQuestionSuggestions({ suggestions: [] }, input)).toEqual([])
  })
  it.each([
    {}, { suggestions: null }, { suggestions: [null] },
    { suggestions: [{ ...input, language: 'zh-HK' }] },
    { suggestions: [{ ...input, market: 'US' }] },
    { suggestions: [{ ...input, category: 'invented' }] },
    { suggestions: [{ ...input, question: ' ' }] },
    { suggestions: [{ ...input, question: 'a'.repeat(501) }] },
  ])('rejects unusable or mismatched suggestions: %j', body => {
    expect(() => parseQuestionSuggestions(body, input)).toThrow()
  })
})

describe('suggestion write acknowledgement', () => {
  it('returns the actual saved row and sends confirmed context', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ prompt }, { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    expect(await saveSuggestedQuestion('client-1', input, new AbortController().signal)).toEqual({ state: 'saved', prompt })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input)
  })
  it.each([400, 401, 403, 404])('retains a known rejection for manual correction: %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status })))
    expect(await saveSuggestedQuestion('client-1', input, new AbortController().signal)).toEqual({ state: 'rejected' })
  })
  it('reports the known question limit independently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ max: 50 }, { status: 409 })))
    expect(await saveSuggestedQuestion('client-1', input, new AbortController().signal)).toEqual({ state: 'rejected', max: 50 })
  })
  it('keeps a conflict as a known rejection even without valid details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(null, { status: 409 })))
    expect(await saveSuggestedQuestion('client-1', input, new AbortController().signal)).toEqual({ state: 'rejected', max: 50 })
  })
  it.each([500, 503, 504, 408])('does not describe an ambiguous response as a safe retry: %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status })))
    expect(await saveSuggestedQuestion('client-1', input, new AbortController().signal)).toEqual({ state: 'unknown' })
  })
  it('preserves an unknown outcome after a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    expect(await saveSuggestedQuestion('client-1', input, new AbortController().signal)).toEqual({ state: 'unknown' })
  })
  it.each([{}, { prompt: {} }, { prompt: { ...prompt, client_id: 'foreign' } }, { prompt: { ...prompt, question: 'different' } }])('does not invent success from malformed acknowledgement: %j', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status: 201 })))
    expect(await saveSuggestedQuestion('client-1', input, new AbortController().signal)).toEqual({ state: 'unknown' })
  })
})
