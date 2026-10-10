import { describe, it, expect, vi } from 'vitest'
import { competitorErrorKey, removeCompetitor, saveCompetitor, splitList } from '@/lib/competitors/client'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ROW = { id: 'comp-1', name: 'Acme', aliases: ['AC'], domains: ['acme.com'], created_at: 't', updated_at: 't' }
const draft = { name: 'Acme', aliases: ['AC'], domains: ['acme.com'] }

describe('splitList', () => {
  it('splits on commas, Chinese commas and new lines, trimming blanks', () => {
    expect(splitList(' HSBC ,匯豐，\nHSBC Bank\n, ')).toEqual(['HSBC', '匯豐', 'HSBC Bank'])
    expect(splitList('')).toEqual([])
  })
})

describe('competitorErrorKey', () => {
  it.each([
    [400, { error: 'name_required' }, 'err_name_required'],
    [400, { error: 'name_too_long' }, 'err_name_too_long'],
    [400, { error: 'invalid_aliases' }, 'err_invalid_aliases'],
    [400, { error: 'too_many_aliases' }, 'err_too_many_aliases'],
    [400, { error: 'invalid_domain' }, 'err_invalid_domain'],
    [400, { error: 'too_many_domains' }, 'err_too_many_domains'],
    [409, { error: 'COMPETITOR_EXISTS' }, 'err_exists'],
    [409, { error: 'COMPETITOR_LIMIT_REACHED', max: 10 }, 'err_limit'],
    [401, { error: 'Unauthorized' }, 'err_signed_out'],
    [500, { error: 'Competitor create failed' }, 'err_generic'],
    [400, { error: 'something new' }, 'err_generic'],
    [400, null, 'err_generic'],
  ])('%i %j → %s', (status, body, key) => {
    expect(competitorErrorKey(status, body)).toBe(key)
  })
})

describe('saveCompetitor', () => {
  it('PATCHes a saved row and returns the server row', async () => {
    const fetcher = vi.fn(async () => json(200, { competitor: ROW }))
    expect(await saveCompetitor(fetcher, 'client-1', 'comp-1', draft)).toEqual({ ok: true, competitor: ROW })
    expect(fetcher).toHaveBeenCalledWith('/api/dashboard/clients/client-1/competitors/comp-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify(draft),
    }))
  })

  it('POSTs a new competitor', async () => {
    const fetcher = vi.fn(async () => json(201, { competitor: ROW }))
    expect(await saveCompetitor(fetcher, 'client-1', null, draft)).toEqual({ ok: true, competitor: ROW })
    expect(fetcher).toHaveBeenCalledWith('/api/dashboard/clients/client-1/competitors', expect.objectContaining({ method: 'POST' }))
  })

  // An onboarding-only name is copied into the table by the POST's own sync
  // step, so the insert itself reports it exists. The row is real now: find it
  // and apply the edit to it.
  it('saves an onboarding-only name by resolving the row its POST created, then patching it', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(409, { error: 'COMPETITOR_EXISTS' }))
      .mockResolvedValueOnce(json(200, { competitors: [{ ...ROW, aliases: [], domains: [] }] }))
      .mockResolvedValueOnce(json(200, { competitor: ROW }))
    expect(await saveCompetitor(fetcher, 'client-1', null, draft, { legacyName: 'acme' })).toEqual({ ok: true, competitor: ROW })
    expect(fetcher.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)).toEqual([
      'POST /api/dashboard/clients/client-1/competitors',
      'GET /api/dashboard/clients/client-1/competitors',
      'PATCH /api/dashboard/clients/client-1/competitors/comp-1',
    ])
  })

  it('reports a genuine duplicate when a new name collides', async () => {
    const fetcher = vi.fn(async () => json(409, { error: 'COMPETITOR_EXISTS' }))
    expect(await saveCompetitor(fetcher, 'client-1', null, draft)).toEqual({ ok: false, error: 'err_exists' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('maps a failed request to a message key, and a network error to generic', async () => {
    expect(await saveCompetitor(vi.fn(async () => json(400, { error: 'invalid_domain' })), 'client-1', 'comp-1', draft))
      .toEqual({ ok: false, error: 'err_invalid_domain' })
    expect(await saveCompetitor(vi.fn(async () => { throw new TypeError('offline') }), 'client-1', 'comp-1', draft))
      .toEqual({ ok: false, error: 'err_generic' })
  })
})

describe('removeCompetitor', () => {
  it('DELETEs a saved row', async () => {
    const fetcher = vi.fn(async () => json(200, { archived: true }))
    expect(await removeCompetitor(fetcher, 'client-1', 'comp-1')).toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledWith('/api/dashboard/clients/client-1/competitors/comp-1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('removes an onboarding-only name by materialising it first', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(409, { error: 'COMPETITOR_EXISTS' }))
      .mockResolvedValueOnce(json(200, { competitors: [ROW] }))
      .mockResolvedValueOnce(json(200, { archived: true }))
    expect(await removeCompetitor(fetcher, 'client-1', null, 'Acme')).toEqual({ ok: true })
    expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe('DELETE')
  })

  it('reports a failed removal', async () => {
    expect(await removeCompetitor(vi.fn(async () => json(500, {})), 'client-1', 'comp-1')).toEqual({ ok: false, error: 'err_generic' })
  })
})
