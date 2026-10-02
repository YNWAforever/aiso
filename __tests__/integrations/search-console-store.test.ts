import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * SQL SHAPE only, through a mocked db(). What the statements DO is proven on real
 * Postgres in __tests__/integration/search-console.test.ts. Here: coverage and the
 * daily rows it describes share one transaction, the coverage upsert moves
 * covered_from only the way a contiguous or a restarting mark says, and a rebind
 * clears coverage only when the property changes.
 */
const m = vi.hoisted(() => ({ sql: vi.fn(), transaction: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => Object.assign(m.sql, { transaction: m.transaction }) }))

import {
  bindProperty,
  listSyncPages,
  loadDueBindings,
  revokeConnectionRow,
  unbindProperty,
  writeDaily,
  writePageQueries,
  type CoverageMark,
  type DailyMetric,
} from '@/lib/integrations/search-console/store'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const CLIENT = '22222222-2222-4222-8222-222222222222'

/** Every template the mock saw, joined with `?` where a value goes, whitespace collapsed. */
const statements = (): string[] =>
  m.sql.mock.calls.map(call => (call[0] as readonly string[]).join('?').replace(/\s+/g, ' ').trim())
const valuesOf = (index: number): unknown[] => m.sql.mock.calls[index]!.slice(1)

const day: DailyMetric = { date: '2026-09-20', scope: 'property', pageUrl: null, clicks: 1, impressions: 10, ctr: 0.1, position: 4 }
const property = (windowStart: string, contiguous: boolean): CoverageMark =>
  ({ scope: 'property', pageUrl: null, windowStart, contiguous })
const pageMark = (pageUrl: string, windowStart: string, contiguous: boolean): CoverageMark =>
  ({ scope: 'page', pageUrl, windowStart, contiguous })

beforeEach(() => {
  vi.resetAllMocks()
  m.sql.mockReturnValue([])
  m.transaction.mockResolvedValue([])
})

describe('writeDaily', () => {
  it('runs the daily upsert and the coverage upserts in ONE transaction', async () => {
    m.transaction.mockResolvedValueOnce([[{ '?column?': 1 }, { '?column?': 1 }], [], []])
    const written = await writeDaily(ACCOUNT, CLIENT, [day, { ...day, date: '2026-09-21' }], [
      property('2026-09-18', true), pageMark('https://x.example/p', '2026-06-27', false),
    ])
    expect(written).toBe(2)
    expect(m.transaction).toHaveBeenCalledTimes(1)
    expect(m.transaction.mock.calls[0]![0]).toHaveLength(3)
    const [daily, keep, restart, ...rest] = statements()
    expect(rest).toEqual([])
    expect(daily).toContain('insert into search_console_daily')
    expect(keep).toContain('insert into search_console_coverage')
    expect(restart).toContain('insert into search_console_coverage')
  })

  it('moves covered_from earlier only for a contiguous mark, and restarts it otherwise', async () => {
    m.transaction.mockResolvedValueOnce([[{ x: 1 }], [], []])
    await writeDaily(ACCOUNT, CLIENT, [day], [property('2026-09-18', true), pageMark('https://x.example/p', '2026-06-27', false)])
    const [, keep, restart] = statements()
    expect(keep).toContain('on conflict on constraint search_console_coverage_unique')
    expect(keep).toContain('least(search_console_coverage.covered_from, excluded.covered_from)')
    // The same statement text serves both kinds; the `contiguous` value is what selects the branch.
    expect(restart).toBe(keep)
    expect(valuesOf(1)).toContain(true)
    expect(valuesOf(2)).toContain(false)
    expect(valuesOf(1)).toEqual(expect.arrayContaining([['property'], [null], ['2026-09-18']]))
    expect(valuesOf(2)).toEqual(expect.arrayContaining([['page'], ['https://x.example/p'], ['2026-06-27']]))
  })

  it('still writes coverage when Google returned no rows, and still in one transaction', async () => {
    m.transaction.mockResolvedValueOnce([[]])
    expect(await writeDaily(ACCOUNT, CLIENT, [], [property('2026-09-18', false)])).toBe(0)
    expect(m.transaction).toHaveBeenCalledTimes(1)
    const [only, ...rest] = statements()
    expect(rest).toEqual([])
    expect(only).toContain('insert into search_console_coverage')
    expect(m.transaction.mock.calls[0]![0]).toHaveLength(1)
  })

  it('does nothing at all when there is neither a row nor a mark', async () => {
    expect(await writeDaily(ACCOUNT, CLIENT, [], [])).toBe(0)
    expect(m.sql).not.toHaveBeenCalled()
    expect(m.transaction).not.toHaveBeenCalled()
  })

  it('names the account in every statement, never `returning *`', async () => {
    m.transaction.mockResolvedValueOnce([[{ x: 1 }], [], []])
    await writeDaily(ACCOUNT, CLIENT, [day], [property('2026-09-18', true), property('2026-09-18', false)])
    statements().forEach((text, i) => {
      expect(valuesOf(i)).toContain(ACCOUNT)
      expect(text).not.toMatch(/returning \*/i)
    })
  })
})

describe('listSyncPages', () => {
  it('left-joins the page-scope coverage row on this account and brand, and maps it', async () => {
    m.sql.mockReturnValueOnce([
      { url: 'https://x.example/a', covered_from: '2026-07-01' },
      { url: 'https://x.example/b', covered_from: null },
    ])
    expect(await listSyncPages(ACCOUNT, CLIENT, 20)).toEqual([
      { url: 'https://x.example/a', coveredFrom: '2026-07-01' },
      { url: 'https://x.example/b', coveredFrom: null },
    ])
    const [text] = statements()
    expect(text).toContain('left join search_console_coverage')
    expect(text).toContain("cov.scope = 'page'")
    expect(text).toContain('cov.account_id = a.account_id')
    expect(text).toContain('a.account_id = ?')
    expect(text).not.toMatch(/returning \*/i)
  })
})

describe('loadDueBindings', () => {
  it('selects the UTC date of the newest ok run since bound_at, and maps it', async () => {
    m.sql.mockReturnValueOnce([
      { account_id: ACCOUNT, client_id: CLIENT, connection_id: 'g', site_url: 's', permission_level: 'siteOwner',
        bound_domain: 'x.example', backfill_pending: false, current_domain: 'x.example', last_ok_date: '2026-09-12', account: {} },
      { account_id: ACCOUNT, client_id: 'c2', connection_id: 'g', site_url: 's', permission_level: 'siteOwner',
        bound_domain: 'x.example', backfill_pending: true, current_domain: 'x.example', last_ok_date: null, account: {} },
    ])
    const due = await loadDueBindings(10)
    expect(due.map(b => b.lastOkDate)).toEqual(['2026-09-12', null])
    const [text] = statements()
    expect(text).toContain("(r.ran_at at time zone 'UTC')::date")
    expect(text).toContain("r.outcome = 'ok'")
    expect(text).toContain('r.ran_at >= b.bound_at')
    expect(text).toContain('r.account_id = b.account_id')
  })
})

describe('bindProperty', () => {
  it('is one statement that clears coverage only after a successful bind, and only when the site URL differs', async () => {
    m.sql.mockReturnValueOnce([{ client_id: CLIENT }])
    expect(await bindProperty({
      accountId: ACCOUNT, clientId: CLIENT, connectionId: 'g', siteUrl: 'sc-domain:x.example',
      permissionLevel: 'siteOwner', boundDomain: 'x.example', profileId: 'p',
    })).toBe(true)
    expect(m.sql).toHaveBeenCalledTimes(1)
    const [text] = statements()
    expect(text).toContain('delete from search_console_coverage')
    expect(text).toContain('exists (select 1 from bound)')
    expect(text).toContain('site_url is distinct from ?')
    // prior is read from the same statement's snapshot, i.e. before the upsert overwrites site_url.
    expect(text.indexOf('prior as')).toBeLessThan(text.indexOf('bound as'))
    expect(text).toContain('select client_id from bound')
    expect(text).not.toMatch(/returning \*/i)
  })

  it('answers false when no row was bound', async () => {
    m.sql.mockReturnValueOnce([])
    expect(await bindProperty({
      accountId: ACCOUNT, clientId: CLIENT, connectionId: 'g', siteUrl: 's',
      permissionLevel: 'siteOwner', boundDomain: 'x.example', profileId: 'p',
    })).toBe(false)
  })
})

describe('unbindProperty and revokeConnectionRow', () => {
  it('deletes the brand coverage and the binding in one transaction and reports whether a binding went', async () => {
    m.transaction.mockResolvedValueOnce([[], [{ client_id: CLIENT }]])
    expect(await unbindProperty(ACCOUNT, CLIENT)).toBe(true)
    expect(m.transaction).toHaveBeenCalledTimes(1)
    const [coverage, binding] = statements()
    expect(coverage).toContain('delete from search_console_coverage')
    expect(coverage).toContain('account_id = ?')
    expect(binding).toContain('delete from search_console_bindings')
    m.transaction.mockResolvedValueOnce([[], []])
    expect(await unbindProperty(ACCOUNT, CLIENT)).toBe(false)
  })

  it('revoking a connection clears the coverage of the brands it bound, before deleting those bindings', async () => {
    m.transaction.mockResolvedValueOnce([[{ id: 'g' }], [], []])
    expect(await revokeConnectionRow(ACCOUNT, 'g')).toBe(true)
    const [, coverage, bindings] = statements()
    expect(coverage).toContain('delete from search_console_coverage')
    expect(coverage).toContain('from search_console_bindings')
    expect(bindings).toContain('delete from search_console_bindings')
  })
})

describe('writePageQueries', () => {
  it('deletes each page over its own window, in one transaction', async () => {
    m.transaction.mockResolvedValueOnce([[], [{ '?column?': 1 }]])
    const written = await writePageQueries(ACCOUNT, CLIENT, [], {
      endDate: '2026-09-24',
      pages: [{ pageUrl: 'https://x.example/new', startDate: '2026-06-27' }, { pageUrl: 'https://x.example/old', startDate: '2026-09-18' }],
    })
    expect(written).toBe(1)
    expect(m.transaction).toHaveBeenCalledTimes(1)
    const [del] = statements()
    expect(del).toContain('using unnest(')
    expect(del).toContain('q.date between w.s::date and ?::date')
    expect(valuesOf(0)).toEqual(expect.arrayContaining([
      ['https://x.example/new', 'https://x.example/old'], ['2026-06-27', '2026-09-18'], '2026-09-24',
    ]))
  })

  it('writes nothing when no page completed', async () => {
    expect(await writePageQueries(ACCOUNT, CLIENT, [], { endDate: '2026-09-24', pages: [] })).toBe(0)
    expect(m.transaction).not.toHaveBeenCalled()
  })
})
