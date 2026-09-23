import { describe, expect, it, vi } from 'vitest'
import { classifyApiFailure, listSites, MAX_PAGES, querySearchAnalytics, ROW_LIMIT } from '@/lib/integrations/search-console/client'

const json = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
const raw = (status: number, text: string) => vi.fn().mockResolvedValue(new Response(text, { status }))

describe('listSites', () => {
  it('returns every property with its permission level', async () => {
    const f = json(200, { siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] })
    expect(await listSites('ya29.t', f)).toEqual([{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }])
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://www.googleapis.com/webmasters/v3/sites')
    expect(init.headers.authorization).toBe('Bearer ya29.t')
  })

  it('treats a login with no properties as an empty list', async () => {
    expect(await listSites('t', json(200, {}))).toEqual([])
  })

  it.each([[401, 'unavailable'], [403, 'forbidden'], [429, 'quota'], [502, 'unavailable']])(
    'maps %i to %s', async (status, kind) => {
      await expect(listSites('t', json(status, {}))).rejects.toMatchObject({ kind })
    })

  it('skips a malformed siteEntry element and keeps the valid one', async () => {
    const f = json(200, { siteEntry: [null, { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] })
    expect(await listSites('t', f)).toEqual([{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }])
  })

  it('sets GoogleApiError.code on a SERVICE_DISABLED failure', async () => {
    const f = json(403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } })
    await expect(listSites('t', f)).rejects.toMatchObject({ kind: 'misconfigured', code: 'SERVICE_DISABLED' })
  })

  it('rejects a non-JSON 200 body as malformed rather than an empty list', async () => {
    await expect(listSites('t', raw(200, 'not json'))).rejects.toMatchObject({ kind: 'unavailable', code: 'malformed_body' })
  })

  it('rejects a JSON null 200 body as malformed rather than an empty list', async () => {
    await expect(listSites('t', raw(200, 'null'))).rejects.toMatchObject({ kind: 'unavailable', code: 'malformed_body' })
  })
})

describe('querySearchAnalytics', () => {
  it('encodes the property, filters to one page and asks for all data states', async () => {
    const f = json(200, { rows: [{ keys: ['2026-09-20'], clicks: 3, impressions: 40, ctr: 0.075, position: 8.2 }] })
    const rows = await querySearchAnalytics('t', 'sc-domain:example.com', {
      startDate: '2026-09-14', endDate: '2026-09-20', dimensions: ['date'], pageEquals: 'https://example.com/p',
    }, f)
    expect(rows).toEqual([{ keys: ['2026-09-20'], clicks: 3, impressions: 40, ctr: 0.075, position: 8.2 }])
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query')
    const body = JSON.parse(init.body)
    expect(body.dataState).toBe('all')
    expect(body.dimensionFilterGroups)
      .toEqual([{ filters: [{ dimension: 'page', operator: 'equals', expression: 'https://example.com/p' }] }])
  })

  it('returns no rows when Google has none', async () => {
    expect(await querySearchAnalytics('t', 'sc-domain:e.com', { startDate: 'a', endDate: 'b', dimensions: ['date'] }, json(200, {})))
      .toEqual([])
  })

  it('maps a 403 to forbidden', async () => {
    await expect(querySearchAnalytics('t', 'sc-domain:e.com', { startDate: 'a', endDate: 'b', dimensions: ['date'] }, json(403, {})))
      .rejects.toMatchObject({ kind: 'forbidden' })
  })

  it('rejects a null row as malformed rather than crashing', async () => {
    await expect(querySearchAnalytics('t', 'sc-domain:e.com', { startDate: 'a', endDate: 'b', dimensions: ['date'] }, json(200, { rows: [null] })))
      .rejects.toMatchObject({ kind: 'unavailable', code: 'malformed_rows' })
  })

  it('rejects a row whose metric is not a finite number', async () => {
    const f = json(200, { rows: [{ keys: ['x'], clicks: 'abc' }] })
    await expect(querySearchAnalytics('t', 'sc-domain:e.com', { startDate: 'a', endDate: 'b', dimensions: ['date'] }, f))
      .rejects.toMatchObject({ kind: 'unavailable', code: 'malformed_rows' })
  })

  it('pages through a full page, sending startRow on the next request', async () => {
    const fullPage = Array.from({ length: ROW_LIMIT }, (_, i) => ({ keys: [String(i)], clicks: 1, impressions: 1, ctr: 1, position: 1 }))
    const shortPage = Array.from({ length: 3 }, (_, i) => ({ keys: [`s${i}`], clicks: 1, impressions: 1, ctr: 1, position: 1 }))
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: fullPage }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: shortPage }), { status: 200 }))
    const rows = await querySearchAnalytics('t', 'sc-domain:e.com', { startDate: 'a', endDate: 'b', dimensions: ['date'] }, f)
    expect(rows).toHaveLength(ROW_LIMIT + 3)
    expect(f).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(f.mock.calls[1]![1].body)
    expect(secondBody.startRow).toBe(ROW_LIMIT)
  })

  it('stops at MAX_PAGES without throwing when every page is still full', async () => {
    const fullPage = Array.from({ length: ROW_LIMIT }, (_, i) => ({ keys: [String(i)], clicks: 1, impressions: 1, ctr: 1, position: 1 }))
    // A fresh Response per call: mockResolvedValue would return the same instance
    // every time, and a Response body can only be read once.
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ rows: fullPage }), { status: 200 }))
    const rows = await querySearchAnalytics('t', 'sc-domain:e.com', { startDate: 'a', endDate: 'b', dimensions: ['date'] }, f)
    expect(f).toHaveBeenCalledTimes(MAX_PAGES)
    expect(rows).toHaveLength(ROW_LIMIT * MAX_PAGES)
  })

  it('rejects a non-JSON 200 body as malformed rather than an empty result', async () => {
    await expect(querySearchAnalytics('t', 'sc-domain:e.com', { startDate: 'a', endDate: 'b', dimensions: ['date'] }, raw(200, 'not json')))
      .rejects.toMatchObject({ kind: 'unavailable', code: 'malformed_body' })
  })

  it('rejects pagination when the second page is a non-JSON 200, not silently returning page one', async () => {
    const fullPage = Array.from({ length: ROW_LIMIT }, (_, i) => ({ keys: [String(i)], clicks: 1, impressions: 1, ctr: 1, position: 1 }))
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: fullPage }), { status: 200 }))
      .mockResolvedValueOnce(new Response('not json', { status: 200 }))
    await expect(querySearchAnalytics('t', 'sc-domain:e.com', { startDate: 'a', endDate: 'b', dimensions: ['date'] }, f))
      .rejects.toMatchObject({ kind: 'unavailable', code: 'malformed_body' })
  })
})

describe('classifyApiFailure', () => {
  const v1 = (reason: string) => ({ error: { errors: [{ reason }] } })
  const v2 = (reason: string) => ({ error: { details: [{ reason }] } })

  it.each([
    [401, {}, 'unavailable'],
    [403, {}, 'forbidden'],
    [403, v2('SERVICE_DISABLED'), 'misconfigured'],
    [403, v1('accessNotConfigured'), 'misconfigured'],
    [403, v1('rateLimitExceeded'), 'quota'],
    [403, v2('ACCESS_TOKEN_SCOPE_INSUFFICIENT'), 'revoked'],
    [403, v1('insufficientPermissions'), 'forbidden'],
    [429, {}, 'quota'],
    [500, {}, 'unavailable'],
  ])('%i %j -> %s', (status, body, kind) => {
    expect(classifyApiFailure(status, body)).toBe(kind)
  })

  it('passes a timeout signal on every call', async () => {
    const f = json(200, {})
    await listSites('t', f)
    expect(f.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
  })
})
