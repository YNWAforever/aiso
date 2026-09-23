import { describe, expect, it, vi } from 'vitest'
import { classifyApiFailure, listSites, querySearchAnalytics } from '@/lib/integrations/search-console/client'

const json = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))

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
