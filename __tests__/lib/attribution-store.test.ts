import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * SQL SHAPE and row mapping only, through a mocked db(). What the statements DO
 * against real Postgres (other accounts' rows excluded, pre-rebind rows hidden,
 * withdraw-then-re-attest) is proven in the integration suite (Task 7). Here:
 * every statement names account_id, nothing uses `returning *`, the date
 * contracts compareTarget relies on are in the text (Hong Kong ok-run dates,
 * plain `date::text`, ISO bound_at), and the source reads are skipped when there
 * is nothing to measure.
 */
const m = vi.hoisted(() => ({ sql: vi.fn(), transaction: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => Object.assign(m.sql, { transaction: m.transaction }) }))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAttributionInput, loadOwnedVersion, loadSyncedPageIds } from '@/lib/attribution/store'
import { PAGE_CAP } from '@/lib/integrations/search-console/sync'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const CLIENT = '22222222-2222-4222-8222-222222222222'
const ITEM = '33333333-3333-4333-8333-333333333333'
const VERSION = '44444444-4444-4444-8444-444444444444'
const ATTEST = '55555555-5555-4555-8555-555555555555'
const ASSET = '66666666-6666-4666-8666-666666666666'

/** Every template the mock saw, joined with `?` where a value goes, whitespace collapsed. */
const statements = (): string[] =>
  m.sql.mock.calls.map(call => (call[0] as readonly string[]).join('?').replace(/\s+/g, ' ').trim())
const valuesOf = (index: number): unknown[] => m.sql.mock.calls[index]!.slice(1)

// 2026-09-11T16:30Z is 00:30 on 12 Sep in Hong Kong (Review Focus 1), so D = 2026-09-12.
const head = (over: Record<string, unknown> = {}) => ({
  found: true,
  schema_version: '1',
  attestation_id: ATTEST,
  delivered_at: '2026-09-11T16:30:00.000000Z',
  withdrawn: false,
  measures: [{ scope: 'page', assetId: ASSET, url: 'https://example.com/a', label: 'Page A' }],
  ...over,
})

const load = (analytics = false) => loadAttributionInput(ACCOUNT, CLIENT, ITEM, VERSION, { analytics })

/**
 * Search Console's sync set, as attribution states it: this brand's registered
 * pages, oldest first by (created_at, id), capped at PAGE_CAP, with listSyncPages'
 * own url-length filter. Whitespace is collapsed by statements().
 */
const SYNC_SET =
  /from client_assets s where s\.account_id = \?::uuid and s\.client_id = \?::uuid and char_length\(s\.url\) <= 2048 order by s\.created_at, s\.id limit \?/

describe('the Search Console sync set', () => {
  it('loadSyncedPageIds is one scoped statement over the sync set, returning ids', async () => {
    m.sql.mockReturnValueOnce([{ id: 'p1' }, { id: 'p2' }])
    expect(await loadSyncedPageIds(ACCOUNT, CLIENT)).toEqual(['p1', 'p2'])
    const [text, ...rest] = statements()
    expect(rest).toEqual([])
    expect(text).toMatch(SYNC_SET)
    expect(text).not.toMatch(/returning \*/i)
    expect(valuesOf(0)).toEqual([ACCOUNT, CLIENT, PAGE_CAP])
  })

  it('states the same order and filter as listSyncPages, which is what the cron really syncs', () => {
    // listSyncPages lives in another store, which this one deliberately does not
    // import; pin its text instead, so either side drifting fails here.
    const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
    const source = read('lib/integrations/search-console/store.ts')
    const body = source.slice(source.indexOf('export async function listSyncPages'))
    const fn = body.slice(0, body.indexOf('\n}\n')).replace(/\s+/g, ' ')
    expect(fn).toContain('where a.account_id = ${accountId} and a.client_id = ${clientId} and char_length(a.url) <= 2048 order by a.created_at, a.id limit ${cap}')
    // And the cron passes PAGE_CAP as that cap.
    expect(read('lib/integrations/search-console/sync.ts')).toContain('deps.listPages(b.accountId, b.clientId, PAGE_CAP)')
  })
})

beforeEach(() => {
  vi.resetAllMocks()
  m.sql.mockReturnValue([])
  m.transaction.mockResolvedValue([[], [], []])
})

describe('loadOwnedVersion', () => {
  it('is one statement, scoped by the session account, through the brand', async () => {
    m.sql.mockReturnValueOnce([{ id: VERSION }])
    expect(await loadOwnedVersion(ACCOUNT, CLIENT, ITEM, VERSION)).toBe(true)
    const [text, ...rest] = statements()
    expect(rest).toEqual([])
    expect(text).toContain('from work_item_versions v')
    expect(text).toContain('v.account_id = ?')
    expect(text).toContain('c.account_id = v.account_id')
    expect(valuesOf(0)).toEqual(expect.arrayContaining([ACCOUNT, CLIENT, ITEM, VERSION]))
  })

  it('is false when no row comes back (absent or not yours)', async () => {
    expect(await loadOwnedVersion(ACCOUNT, CLIENT, ITEM, VERSION)).toBe(false)
  })

  it('lets a driver error escape so the guard can answer 503', async () => {
    m.sql.mockImplementationOnce(() => { throw new Error('boom') })
    await expect(loadOwnedVersion(ACCOUNT, CLIENT, ITEM, VERSION)).rejects.toThrow('boom')
  })
})

describe('loadAttributionInput: the attestation read', () => {
  it('is null when the version is not this account\'s', async () => {
    m.sql.mockReturnValueOnce([{ ...head(), found: false }])
    expect(await load()).toBeNull()
  })

  it('reads the LATEST attestation, whether it is withdrawn, and only that attestation\'s measures (Review Focus 4)', async () => {
    m.sql.mockReturnValueOnce([head()])
    await load()
    const text = statements()[0]!
    // Newest attest event of this version, by recorded_at with the id as tiebreak.
    expect(text).toMatch(/e\.kind = 'attest'.*order by e\.recorded_at desc, e\.id desc limit 1/)
    // A withdraw that targets THAT attestation.
    expect(text).toContain("w.target_attestation_id = l.id")
    expect(text).toContain("w.kind = 'withdraw'")
    // Measures belong to the latest attestation only: a withdrawn earlier one's rows never surface.
    expect(text).toContain('m.attestation_id = l.id')
    // Assets through the composite key, tenancy on both.
    expect(text).toContain('a.account_id = m.account_id and a.client_id = m.client_id and a.id = m.asset_id')
    // schemaVersion straight from the frozen content.
    expect(text).toContain("v.content ->> 'schemaVersion'")
    // delivered_at as an ISO instant, never a (UTC) date.
    expect(text).toContain('to_char(l.delivered_at at time zone \'UTC\'')
    expect(text).not.toMatch(/delivered_at::date/)
  })

  it('maps the head row', async () => {
    m.sql.mockReturnValueOnce([head({ withdrawn: true })])
    const input = await load()
    expect(input).toMatchObject({
      schemaVersion: 1,
      attestation: { id: ATTEST, deliveredAt: '2026-09-11T16:30:00.000000Z', withdrawn: true },
      measures: [{ scope: 'page', asset: { id: ASSET, url: 'https://example.com/a', label: 'Page A' } }],
      sources: null,
    })
  })

  it('maps a site measure to a null asset', async () => {
    m.sql.mockReturnValueOnce([head({ measures: [{ scope: 'site', assetId: null, url: null, label: null, synced: null }] })])
    m.transaction.mockResolvedValueOnce([[], [], []])
    const input = await load()
    // The property is always synced, so a site measure is never "not synced".
    expect(input!.measures).toEqual([{ scope: 'site', asset: null, synced: true }])
  })

  it('marks each measured page by whether Search Console syncs it, from the same set listSyncPages takes', async () => {
    m.sql.mockReturnValueOnce([head({
      measures: [
        { scope: 'page', assetId: ASSET, url: 'https://example.com/a', label: 'Page A', synced: true },
        { scope: 'page', assetId: ATTEST, url: 'https://example.com/b', label: 'Page B', synced: false },
      ],
    })])
    const input = await load()
    expect(input!.measures.map(t => t.synced)).toEqual([true, false])
    const text = statements()[0]!
    // The PAGE_CAP oldest registered pages of this brand, in listSyncPages' order.
    expect(text).toMatch(SYNC_SET)
    expect(text).toContain("'synced', exists (select 1 from synced s where s.id = a.id)")
    expect(valuesOf(0)).toContain(PAGE_CAP)
  })

  it('reads a missing synced flag on a page as not synced, never as synced', async () => {
    m.sql.mockReturnValueOnce([head({ measures: [{ scope: 'page', assetId: ASSET, url: 'https://example.com/a', label: 'Page A' }] })])
    expect((await load())!.measures[0]!.synced).toBe(false)
  })

  it.each([
    ['no attestation', { attestation_id: null, delivered_at: null, measures: [] }],
    ['a withdrawn attestation', { withdrawn: true }],
    ['an unsupported version', { schema_version: '2' }],
    ['no measures', { measures: [] }],
  ])('reads no source at all for %s', async (_label, over) => {
    m.sql.mockReturnValueOnce([head(over)])
    const input = await load(true)
    expect(input!.sources).toBeNull()
    expect(m.transaction).not.toHaveBeenCalled()
    expect(statements()).toHaveLength(1)
  })
})

describe('loadAttributionInput: the source reads', () => {
  const searchBinding = { bound_at: '2026-06-01T00:00:00.000000Z', last_ok_day: '2026-10-15', latest_outcome: 'ok' }

  it('reads Search Console in one read-only repeatable-read snapshot, every statement scoped', async () => {
    m.sql.mockReturnValueOnce([head()])
    m.transaction.mockResolvedValueOnce([[searchBinding], [], []])
    await load()
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Array), { isolationLevel: 'RepeatableRead', readOnly: true })
    const all = statements()
    for (const text of all) {
      expect(text).toContain('account_id = ?')
      expect(text).not.toMatch(/returning \*/i)
    }
  })

  it('reads the binding with Hong Kong ok-run dates since bound_at and the latest non-deferred outcome', async () => {
    m.sql.mockReturnValueOnce([head()])
    m.transaction.mockResolvedValueOnce([[searchBinding], [], []])
    await load()
    const binding = statements().find(s => s.includes('from search_console_bindings b'))!
    expect(binding).toContain("to_char(b.bound_at at time zone 'UTC'")
    expect(binding).not.toMatch(/bound_at::date/)
    expect(binding).toContain("(r.ran_at at time zone 'Asia/Hong_Kong')::date")
    expect(binding).toContain("r.outcome = 'ok' and r.ran_at >= b.bound_at")
    expect(binding).toContain("r.outcome <> 'deferred' and r.ran_at >= b.bound_at")
    expect(binding).toContain('from search_console_sync_runs r')
  })

  it('reads coverage for the property and the measured pages only', async () => {
    m.sql.mockReturnValueOnce([head()])
    m.transaction.mockResolvedValueOnce([[searchBinding], [], []])
    await load()
    const index = statements().findIndex(s => s.includes('from search_console_coverage'))
    const text = statements()[index]!
    expect(text).toContain('covered_from::text')
    expect(text).toContain('page_url = any(')
    expect(valuesOf(index)).toEqual(expect.arrayContaining([['https://example.com/a']]))
  })

  it('reads daily rows over D-28..D+28, synced under the current binding, as plain dates in date order', async () => {
    m.sql.mockReturnValueOnce([head()])
    m.transaction.mockResolvedValueOnce([[searchBinding], [], []])
    await load()
    const index = statements().findIndex(s => s.includes('from search_console_daily d'))
    const text = statements()[index]!
    expect(text).toContain('d.date::text as date')
    expect(text).toContain('d.synced_at >= b.bound_at')
    expect(text).toContain('b.account_id = d.account_id and b.client_id = d.client_id')
    expect(text).toMatch(/d\.date between \?::date and \?::date/)
    expect(text).toMatch(/order by .*d\.date/)
    // D = 2026-09-12 (Hong Kong), so the read spans 2026-08-15 .. 2026-10-10.
    expect(valuesOf(index)).toEqual(expect.arrayContaining(['2026-08-15', '2026-10-10']))
  })

  it('maps the source rows', async () => {
    m.sql.mockReturnValueOnce([head()])
    m.transaction.mockResolvedValueOnce([
      [searchBinding],
      [{ scope: 'page', page_url: 'https://example.com/a', covered_from: '2026-06-01' }],
      [{ scope: 'page', page_url: 'https://example.com/a', date: '2026-09-01', clicks: 3, impressions: '40', position: 7.5 }],
    ])
    const input = await load()
    expect(input!.sources).toEqual({
      search: { boundAt: '2026-06-01T00:00:00.000000Z', okRunDates: ['2026-10-15'], latestOutcome: 'ok' },
      coverage: [{ scope: 'page', pageUrl: 'https://example.com/a', coveredFrom: '2026-06-01' }],
      searchDays: [{ scope: 'page', pageUrl: 'https://example.com/a', date: '2026-09-01', clicks: 3, impressions: 40, position: 7.5 }],
      enquiries: null,
    })
  })

  it('maps an unbound brand to a null search state and no ok-run dates for a binding without a good run', async () => {
    m.sql.mockReturnValueOnce([head()])
    m.transaction.mockResolvedValueOnce([[], [], []])
    expect((await load())!.sources!.search).toBeNull()

    m.sql.mockReturnValueOnce([head()])
    m.transaction.mockResolvedValueOnce([[{ ...searchBinding, last_ok_day: null, latest_outcome: null }], [], []])
    expect((await load())!.sources!.search).toEqual({ boundAt: searchBinding.bound_at, okRunDates: [], latestOutcome: null })
  })

  it('does not read GA4 for page-only measures, even with analytics on', async () => {
    m.sql.mockReturnValueOnce([head()])
    m.transaction.mockResolvedValueOnce([[searchBinding], [], []])
    const input = await load(true)
    expect(statements().some(s => /analytics_/.test(s))).toBe(false)
    expect(input!.sources!.enquiries).toBeNull()
  })

  it('does not read GA4 for a site measure with analytics off', async () => {
    m.sql.mockReturnValueOnce([head({ measures: [{ scope: 'site', assetId: null, url: null, label: null }] })])
    m.transaction.mockResolvedValueOnce([[searchBinding], [], []])
    const input = await load(false)
    expect(statements().some(s => /analytics_/.test(s))).toBe(false)
    expect(input!.sources!.enquiries).toBeNull()
  })

  describe('a site measure with analytics on', () => {
    const site = head({ measures: [{ scope: 'site', assetId: null, url: null, label: null }] })
    const analyticsBinding = {
      bound_at: '2026-06-01T00:00:00.000000Z', covered_from: '2026-06-02', last_ok_day: '2026-10-15', latest_outcome: 'ok',
    }

    it('reads the analytics binding and its ledger since greatest(bound_at, events_chosen_at)', async () => {
      m.sql.mockReturnValueOnce([site])
      m.transaction.mockResolvedValueOnce([[searchBinding], [], [], [analyticsBinding], []])
      await load(true)
      const binding = statements().find(s => s.includes('from analytics_bindings b'))!
      expect(binding).toContain('b.account_id = ?')
      expect(binding).toContain('b.covered_from::text as covered_from')
      expect(binding).toContain("to_char(b.bound_at at time zone 'UTC'")
      expect(binding).toContain("(r.ran_at at time zone 'Asia/Hong_Kong')::date")
      expect(binding).toContain("r.outcome = 'ok' and r.ran_at >= greatest(b.bound_at, b.events_chosen_at)")
      expect(binding).toContain("r.outcome <> 'deferred' and r.ran_at >= greatest(b.bound_at, b.events_chosen_at)")
    })

    it('reads whether any ok GA4 run since greatest(bound_at, events_chosen_at) withheld data, account-scoped', async () => {
      m.sql.mockReturnValueOnce([site])
      m.transaction.mockResolvedValueOnce([[searchBinding], [], [], [analyticsBinding], []])
      await load(true)
      const binding = statements().find(s => s.includes('from analytics_bindings b'))!
      const withheld = binding.match(/\(select coalesce\(bool_or\(r\.data_withheld\), false\).*?\) as data_withheld/)?.[0]
      expect(withheld, 'the withheld read').toBeDefined()
      // The same run predicate as readiness: ok runs of the current binding and event choice only.
      expect(withheld).toContain('from analytics_sync_runs r')
      expect(withheld).toContain('r.account_id = b.account_id and r.client_id = b.client_id')
      expect(withheld).toContain("r.outcome = 'ok' and r.ran_at >= greatest(b.bound_at, b.events_chosen_at)")
      // And the binding it correlates with is the session account's.
      expect(binding).toContain('b.account_id = ?')
    })

    it('maps a withheld GA4 run onto the state, and nothing withheld onto false', async () => {
      m.sql.mockReturnValueOnce([site])
      m.transaction.mockResolvedValueOnce([[searchBinding], [], [], [{ ...analyticsBinding, data_withheld: true }], []])
      expect((await load(true))!.sources!.enquiries!.state!.withheld).toBe(true)
      m.sql.mockReturnValueOnce([site])
      m.transaction.mockResolvedValueOnce([[searchBinding], [], [], [{ ...analyticsBinding, data_withheld: false }], []])
      expect((await load(true))!.sources!.enquiries!.state!.withheld).toBe(false)
    })

    it('reads analytics_daily for the chosen events only, synced since the binding and the event choice', async () => {
      m.sql.mockReturnValueOnce([site])
      m.transaction.mockResolvedValueOnce([[searchBinding], [], [], [analyticsBinding], []])
      await load(true)
      const index = statements().findIndex(s => s.includes('from analytics_daily d'))
      const text = statements()[index]!
      expect(text).toContain('d.account_id = ?')
      expect(text).toContain('d.event_name = any(b.key_events)')
      expect(text).toContain('d.synced_at >= greatest(b.bound_at, b.events_chosen_at)')
      expect(text).toContain('d.date::text as date')
      expect(text).toMatch(/order by d\.date, d\.source_class/)
      expect(valuesOf(index)).toEqual(expect.arrayContaining(['2026-08-15', '2026-10-10']))
    })

    it('maps the GA4 state and days', async () => {
      m.sql.mockReturnValueOnce([site])
      m.transaction.mockResolvedValueOnce([
        [searchBinding], [], [],
        [analyticsBinding],
        [{ date: '2026-09-01', source_class: 'ai_assistant', count: '4' }],
      ])
      const input = await load(true)
      expect(input!.sources!.enquiries).toEqual({
        state: { boundAt: analyticsBinding.bound_at, coveredFrom: '2026-06-02', okRunDates: ['2026-10-15'], latestOutcome: 'ok', withheld: false },
        days: [{ date: '2026-09-01', sourceClass: 'ai_assistant', count: 4 }],
      })
    })

    it('maps an unbound GA4 brand to a null state', async () => {
      m.sql.mockReturnValueOnce([site])
      m.transaction.mockResolvedValueOnce([[searchBinding], [], [], [], []])
      expect((await load(true))!.sources!.enquiries).toEqual({ state: null, days: [] })
    })
  })

  it('lets a driver error escape so the service can answer 503', async () => {
    m.sql.mockReturnValueOnce([head()])
    m.transaction.mockRejectedValueOnce(new Error('postgresql://u:secret@h/db'))
    await expect(load()).rejects.toThrow()
  })
})
