import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * SQL SHAPE only, through a mocked db(). What the statements DO is proven on real
 * Postgres in the integration suite (Task 15). Here: every statement names
 * account_id (except the one declared cross-account read), nothing uses
 * `returning *`, multi-statement work runs in a transaction, and the two filters
 * the panel's correctness rests on (bound_at, owner figures) are present.
 */
const m = vi.hoisted(() => ({ sql: vi.fn(), transaction: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => Object.assign(m.sql, { transaction: m.transaction }) }))

import {
  bindStream,
  loadAnalyticsBinding,
  loadAnalyticsPanel,
  loadDueAnalyticsBindings,
  recordAnalyticsRun,
  replaceDailyWindow,
  unbindStream,
  updateKeyEvents,
} from '@/lib/integrations/analytics/store'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const CLIENT = '22222222-2222-4222-8222-222222222222'
const CONNECTION = '33333333-3333-4333-8333-333333333333'

/** Every template the mock saw, joined with `?` where a value goes, whitespace collapsed. */
const statements = (): string[] =>
  m.sql.mock.calls.map(call => (call[0] as readonly string[]).join('?').replace(/\s+/g, ' ').trim())
const valuesOf = (index: number): unknown[] => m.sql.mock.calls[index]!.slice(1)

beforeEach(() => {
  vi.resetAllMocks()
  m.sql.mockReturnValue([])
  m.transaction.mockResolvedValue([])
})

describe('bindStream', () => {
  const input = {
    accountId: ACCOUNT, clientId: CLIENT, connectionId: CONNECTION,
    propertyId: '123', streamId: '456', streamHost: 'example.com', keyEvents: ['generate_lead'],
  }

  it('is one statement, tenancy inside it, upserting on the account+client key', async () => {
    m.sql.mockReturnValueOnce([{ client_id: CLIENT }])
    expect(await bindStream(input)).toBe('bound')
    const [text, ...rest] = statements()
    expect(rest).toEqual([])
    expect(text).toContain('insert into analytics_bindings')
    expect(text).toContain('from clients c')
    expect(text).toContain('c.account_id = ?')
    expect(text).toContain('g.account_id = c.account_id')
    expect(text).toContain('on conflict on constraint analytics_bindings_account_client_unique')
    expect(text).not.toMatch(/returning \*/i)
    expect(m.transaction).not.toHaveBeenCalled()
  })

  it('moves bound_at only when the connection, property or stream changes', async () => {
    m.sql.mockReturnValueOnce([{ client_id: CLIENT }])
    await bindStream(input)
    const text = statements()[0]!
    const boundAt = text.slice(text.indexOf('bound_at = case'), text.indexOf('end', text.indexOf('bound_at = case')) + 3)
    for (const column of ['connection_id', 'property_id', 'stream_id']) {
      expect(boundAt).toContain(`analytics_bindings.${column} is distinct from excluded.${column}`)
    }
    expect(boundAt).toContain('else analytics_bindings.bound_at')
    // The events and the backfill flag are reset on every bind, changed stream or not.
    expect(text).toContain('key_events = excluded.key_events')
    expect(text).toContain('events_chosen_at = now()')
    expect(text).toContain('backfill_pending = true')
    expect(text).toContain('updated_at = now()')
  })

  it('answers not_found when no row came back (absent or not this account)', async () => {
    m.sql.mockReturnValueOnce([])
    expect(await bindStream(input)).toBe('not_found')
  })
})

describe('updateKeyEvents and unbindStream', () => {
  it('updateKeyEvents re-arms the backfill under account_id and reports whether a row matched', async () => {
    m.sql.mockReturnValueOnce([{ client_id: CLIENT }])
    expect(await updateKeyEvents(ACCOUNT, CLIENT, ['a', 'B'])).toBe(true)
    const text = statements()[0]!
    expect(text).toContain('update analytics_bindings')
    expect(text).toContain('key_events = ?::text[]')
    expect(text).toContain('events_chosen_at = now()')
    expect(text).toContain('backfill_pending = true')
    expect(text).toContain('account_id = ?')
    expect(text).not.toContain('bound_at')
    m.sql.mockReturnValueOnce([])
    expect(await updateKeyEvents(ACCOUNT, CLIENT, ['a'])).toBe(false)
  })

  it('unbindStream deletes by account and client, and reports whether it did', async () => {
    m.sql.mockReturnValueOnce([{ client_id: CLIENT }])
    expect(await unbindStream(ACCOUNT, CLIENT)).toBe(true)
    const text = statements()[0]!
    expect(text).toContain('delete from analytics_bindings')
    expect(text).toContain('account_id = ?')
    expect(text).toContain('client_id = ?')
    m.sql.mockReturnValueOnce([])
    expect(await unbindStream(ACCOUNT, CLIENT)).toBe(false)
  })
})

describe('loadAnalyticsBinding', () => {
  it('is account-scoped and returns ISO timestamps', async () => {
    m.sql.mockReturnValueOnce([{
      connection_id: CONNECTION, property_id: '123', stream_id: '456', stream_host: 'example.com',
      key_events: ['generate_lead'], events_chosen_at: new Date('2026-09-01T00:00:00.000Z'),
      bound_at: new Date('2026-08-01T00:00:00.000Z'), backfill_pending: true,
    }])
    expect(await loadAnalyticsBinding(ACCOUNT, CLIENT)).toEqual({
      connectionId: CONNECTION, propertyId: '123', streamId: '456', streamHost: 'example.com',
      keyEvents: ['generate_lead'], eventsChosenAt: '2026-09-01T00:00:00.000Z',
      boundAt: '2026-08-01T00:00:00.000Z', backfillPending: true,
    })
    expect(statements()[0]).toContain('b.account_id = ?')
  })

  it('returns null when there is no binding', async () => {
    expect(await loadAnalyticsBinding(ACCOUNT, CLIENT)).toBeNull()
  })
})

describe('loadDueAnalyticsBindings (the declared cross-account read)', () => {
  const row = {
    account_id: ACCOUNT, client_id: CLIENT, connection_id: CONNECTION, property_id: '123', stream_id: '456',
    stream_host: 'example.com', key_events: ['generate_lead'],
    events_chosen_at: new Date('2026-09-01T00:00:00.000Z'), bound_at: new Date('2026-08-01T00:00:00.000Z'),
    backfill_pending: false, current_domain: 'example.com', account: { plan: 'pro', status: 'active' },
  }

  it('keeps each binding with its own account through joins, active connections only, least recently attempted first', async () => {
    m.sql.mockReturnValueOnce([row])
    const due = await loadDueAnalyticsBindings(7)
    const text = statements()[0]!
    expect(text).toContain('g.account_id = b.account_id')
    expect(text).toContain('c.account_id = b.account_id')
    expect(text).toContain('a.id = b.account_id')
    expect(text).toContain("g.status = 'active'")
    expect(text).toContain('from analytics_sync_runs r')
    expect(text).toContain('r.account_id = b.account_id')
    expect(text).toContain('order by last_run.ran_at asc nulls first')
    expect(text).not.toMatch(/returning \*/i)
    expect(valuesOf(0)).toEqual([7])
    expect(due).toEqual([{
      accountId: ACCOUNT, clientId: CLIENT, connectionId: CONNECTION, propertyId: '123', streamId: '456',
      streamHost: 'example.com', keyEvents: ['generate_lead'], eventsChosenAt: '2026-09-01T00:00:00.000Z',
      boundAt: '2026-08-01T00:00:00.000Z', backfillPending: false, currentDomain: 'example.com',
      account: { plan: 'pro', status: 'active' },
    }])
  })

  it('orders by the newest ledger row of ANY outcome, not the newest ok', async () => {
    await loadDueAnalyticsBindings(1)
    expect(statements()[0]).not.toContain("outcome = 'ok'")
  })
})

describe('replaceDailyWindow', () => {
  const counts = [
    { date: '2026-09-01', eventName: 'generate_lead', sourceClass: 'organic_search' as const, count: 3 },
    { date: '2026-09-02', eventName: 'generate_lead', sourceClass: 'ai_assistant' as const, count: 1 },
  ]

  it('deletes the window then inserts, in one transaction, and returns the inserted count', async () => {
    m.transaction.mockResolvedValueOnce([[], [{ '?column?': 1 }, { '?column?': 1 }]])
    expect(await replaceDailyWindow(ACCOUNT, CLIENT, { startDate: '2026-09-01', endDate: '2026-09-07' }, counts)).toBe(2)
    expect(m.transaction).toHaveBeenCalledTimes(1)
    const [remove, insert] = statements()
    expect(statements()).toHaveLength(2)
    expect(remove).toContain('delete from analytics_daily')
    expect(remove).toContain('account_id = ?')
    expect(remove).toContain('client_id = ?')
    expect(remove).toContain('date between ?::date and ?::date')
    expect(insert).toContain('insert into analytics_daily')
    expect(insert).toContain('unnest(')
    expect(insert).toContain('::bigint[]')
    expect(insert).not.toMatch(/returning \*/i)
    // The values reach the driver as parallel arrays, not as string-built SQL.
    expect(valuesOf(1)).toEqual(expect.arrayContaining([['2026-09-01', '2026-09-02'], ['generate_lead', 'generate_lead'], [3, 1]]))
  })

  it('still runs the delete when the window came back empty', async () => {
    m.transaction.mockResolvedValueOnce([[], []])
    expect(await replaceDailyWindow(ACCOUNT, CLIENT, { startDate: '2026-09-01', endDate: '2026-09-07' }, [])).toBe(0)
    expect(m.transaction).toHaveBeenCalledTimes(1)
    expect(statements()[0]).toContain('delete from analytics_daily')
  })
})

describe('recordAnalyticsRun', () => {
  const input = {
    accountId: ACCOUNT, clientId: CLIENT, connectionId: CONNECTION, propertyId: '123', streamId: '456',
    outcome: 'ok' as const, rowsWritten: 5, dataThrough: '2026-09-07', dataWithheld: true, clearBackfill: true,
  }

  it('appends the ledger row and clears the backfill in one transaction', async () => {
    await recordAnalyticsRun(input)
    expect(m.transaction).toHaveBeenCalledTimes(1)
    const [ledger, clear] = statements()
    expect(ledger).toContain('insert into analytics_sync_runs')
    expect(ledger).toContain('account_id')
    expect(ledger).toContain('data_withheld')
    expect(ledger).toContain('?::date')
    expect(clear).toContain('update analytics_bindings set backfill_pending = false')
    expect(clear).toContain('account_id = ?')
  })

  it('clears backfill only where the binding is still this connection, property and stream', async () => {
    await recordAnalyticsRun(input)
    const clear = statements()[1]!
    for (const column of ['connection_id', 'property_id', 'stream_id']) expect(clear).toContain(`${column} = ?`)
    expect(clear).toContain('?::boolean')
    expect(valuesOf(1)).toContain(true)
  })

  it('passes clearBackfill false through so the flag stays set', async () => {
    await recordAnalyticsRun({ ...input, clearBackfill: false })
    expect(valuesOf(1)).toContain(false)
    expect(valuesOf(1)).not.toContain(true)
  })
})

describe('loadAnalyticsPanel', () => {
  const BOUND_AT = '2026-08-01T00:00:00.000Z'
  const run = { outcome: 'ok', data_through: '2026-09-07', ran_at: new Date('2026-09-08T09:00:00.000Z'), data_withheld: false }
  const load = (results: unknown[][]) => {
    m.transaction.mockResolvedValueOnce(results)
    return loadAnalyticsPanel(ACCOUNT, CLIENT, ['generate_lead', 'Purchase'], BOUND_AT)
  }

  it('reads everything in one read-only repeatable-read snapshot', async () => {
    await load([[], [], [], []])
    expect(m.transaction).toHaveBeenCalledTimes(1)
    expect(m.transaction.mock.calls[0]![1]).toEqual({ isolationLevel: 'RepeatableRead', readOnly: true })
    expect(statements()).toHaveLength(4)
    for (const text of statements()) {
      expect(text).toContain('account_id = ?')
      expect(text).not.toMatch(/returning \*/i)
    }
  })

  it('filters daily rows by the chosen events and by bound_at, over the 28 days ending at the newest one', async () => {
    await load([[], [], [], []])
    const daily = statements().find(text => text.includes('from analytics_daily'))!
    expect(daily).toContain('event_name = any(?::text[])')
    expect(daily).toContain('synced_at >= ?::timestamptz')
    expect(daily).toContain('max(date)')
    expect(daily).toContain('- 28')
    expect(daily).toContain('sum(c.count)::bigint')
    expect(m.sql.mock.calls.flatMap(call => call.slice(1))).toEqual(
      expect.arrayContaining([['generate_lead', 'Purchase'], BOUND_AT]),
    )
  })

  it('takes the last good date from the newest ok run since bound_at', async () => {
    await load([[], [], [], []])
    const lastGood = statements().find(text => text.includes("outcome = 'ok'"))!
    expect(lastGood).toContain('ran_at >= ?::timestamptz')
    expect(lastGood).toContain('order by ran_at desc')
  })

  it('reads the owner figures as text from local_trust_profiles by client and account', async () => {
    await load([[], [], [], []])
    const owner = statements().find(text => text.includes('local_trust_profiles'))!
    expect(owner).toContain('average_lead_value::text')
    expect(owner).toContain('close_rate::text')
    expect(owner).toContain('client_id = ?')
    expect(owner).toContain('account_id = ?')
  })

  it('maps rows: numbers from bigint strings, all three source classes, events by count then name, ISO times', async () => {
    const panel = await load([
      [run],
      [{ data_through: '2026-09-07' }],
      [
        { event_name: 'purchase', source_class: 'organic_search', total: '4' },
        { event_name: 'generate_lead', source_class: 'organic_search', total: '3' },
        { event_name: 'generate_lead', source_class: 'ai_assistant', total: '2' },
        { event_name: 'a_event', source_class: 'other', total: '5' },
      ],
      [{ lead_value: '1500.50', close_rate: '0.25' }],
    ])
    expect(panel).toEqual({
      latest: { outcome: 'ok', dataThrough: '2026-09-07', ranAt: '2026-09-08T09:00:00.000Z', dataWithheld: false },
      lastGoodDataThrough: '2026-09-07',
      last28: {
        total: 14,
        bySource: { organic_search: 7, ai_assistant: 2, other: 5 },
        // generate_lead 5, a_event 5, purchase 4: count desc, then name asc.
        byEvent: [
          { eventName: 'a_event', count: 5 },
          { eventName: 'generate_lead', count: 5 },
          { eventName: 'purchase', count: 4 },
        ],
      },
      owner: { leadValue: '1500.50', closeRate: '0.25' },
    })
  })

  it('has every source class at 0 when a class is absent', async () => {
    const panel = await load([[], [], [{ event_name: 'x', source_class: 'other', total: '2' }], []])
    expect(panel.last28?.bySource).toEqual({ organic_search: 0, ai_assistant: 0, other: 2 })
  })

  it('has last28 null with no rows, null figures with no profile, and null latest with no ledger', async () => {
    expect(await load([[], [], [], []])).toEqual({
      latest: null,
      lastGoodDataThrough: null,
      last28: null,
      owner: { leadValue: null, closeRate: null },
    })
  })

  it('keeps a real 0 lead value and a null close rate distinct from absence', async () => {
    const panel = await load([[], [], [], [{ lead_value: '0', close_rate: null }]])
    expect(panel.owner).toEqual({ leadValue: '0', closeRate: null })
  })

  it('reports withheld data on the latest run', async () => {
    const panel = await load([[{ ...run, data_withheld: true }], [], [], []])
    expect(panel.latest?.dataWithheld).toBe(true)
  })
})

describe('every statement is account-scoped and none returns *', () => {
  it('holds for each exported writer and reader except the declared cross-account read', async () => {
    m.sql.mockReturnValue([{ client_id: CLIENT }])
    m.transaction.mockResolvedValue([[], [], [], []])
    await bindStream({
      accountId: ACCOUNT, clientId: CLIENT, connectionId: CONNECTION,
      propertyId: '1', streamId: '2', streamHost: 'h', keyEvents: ['e'],
    })
    await updateKeyEvents(ACCOUNT, CLIENT, ['e'])
    await unbindStream(ACCOUNT, CLIENT)
    await loadAnalyticsBinding(ACCOUNT, CLIENT)
    await replaceDailyWindow(ACCOUNT, CLIENT, { startDate: '2026-09-01', endDate: '2026-09-02' }, [])
    await recordAnalyticsRun({
      accountId: ACCOUNT, clientId: CLIENT, connectionId: CONNECTION, propertyId: '1', streamId: '2',
      outcome: 'deferred', rowsWritten: 0, dataThrough: null, dataWithheld: false, clearBackfill: false,
    })
    await loadAnalyticsPanel(ACCOUNT, CLIENT, ['e'], '2026-08-01T00:00:00.000Z')
    const all = statements()
    expect(all.length).toBeGreaterThanOrEqual(10)
    for (const text of all) {
      expect(text, text).toContain('account_id')
      expect(text, text).not.toMatch(/returning\s+\*/i)
    }
  })
})
