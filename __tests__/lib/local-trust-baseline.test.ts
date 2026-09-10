import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, Scan } from '@/lib/types'

/**
 * Where the enquiry-value baseline actually comes from.
 *
 * `estimateRoi` used to invent it — `previousScore ?? Math.max(0, score - 5)`,
 * with no caller supplying the left side. The arithmetic downstream was fine; the
 * input was fiction, and the figure was identical for every client. These tests
 * cover the read that replaced it, and the two things about that read which are
 * easy to get silently wrong: the tenancy filter, and the fact that
 * `local_trust_score` is a `numeric` column that arrives as a **string**.
 *
 * A string baseline would not throw. `50 - '45.00'` is 5, so the figure would look
 * plausible and only `assumptions.previousScore` — which the panel prints — would
 * carry the tell. That is the class of bug this file exists for.
 */

type Query = { text: string; values: unknown[] }
const queries: Query[] = []
let previousRows: unknown[] = []

const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?')
  queries.push({ text, values })

  if (text.includes('select local_trust_score, snapshot_month')) return Promise.resolve(previousRows)
  if (text.includes('insert into local_trust_snapshots')) {
    return Promise.resolve([{ id: 'snapshot-1', client_id: 'client-1', local_trust_score: 61 }])
  }
  return Promise.resolve([])
})

vi.mock('@/lib/db', () => ({ db: () => mockSql }))

import { getOrCreateLocalTrustSnapshot, getPreviousLocalTrustBaseline } from '@/lib/localTrust/store'

const client = { id: 'client-1', industry: 'legal', domain: 'harbour.example' } as Client
const scan = { id: 'scan-1', created_at: '2026-06-20T00:00:00.000Z', results: {} } as unknown as Scan
const profile = { average_lead_value: '8000.00', close_rate: '0.20' } as never

const snapshotFor = (over: Record<string, unknown> = {}) => getOrCreateLocalTrustSnapshot({
  client,
  accountId: 'account-1',
  latestScan: scan,
  profile,
  pulseSummary: [],
  missed: [],
  competitors: [],
  ...over,
})

beforeEach(() => {
  queries.length = 0
  previousRows = []
  mockSql.mockClear()
})

describe('getPreviousLocalTrustBaseline', () => {
  it('reads the newest row strictly before the month being written, scoped to the account', () => {
    // There is no database-level tenancy backstop — migration 036 disabled RLS —
    // so a missing account_id here would read another account's score into this
    // account's figure. `<` rather than `<=` keeps the row about to be upserted
    // for this month out of its own baseline.
    void getPreviousLocalTrustBaseline({
      clientId: 'client-1',
      accountId: 'account-1',
      beforeMonth: '2026-06-01',
    })

    const query = queries.at(-1)!
    expect(query.text).toContain('from local_trust_snapshots')
    expect(query.text).toContain('client_id')
    expect(query.text).toContain('account_id')
    expect(query.text).toContain('snapshot_month <')
    expect(query.text).toContain('order by snapshot_month desc')
    expect(query.text).toContain('limit 1')
    expect(query.values).toEqual(['client-1', 'account-1', '2026-06-01'])
  })

  it('coerces the numeric column, which the driver hands back as a string', async () => {
    previousRows = [{ local_trust_score: '45.00', snapshot_month: '2026-05-01' }]

    const result = await getPreviousLocalTrustBaseline({
      clientId: 'client-1', accountId: 'account-1', beforeMonth: '2026-06-01',
    })

    expect(result).toEqual({ score: 45, month: '2026-05-01' })
    expect(typeof result!.score).toBe('number')
  })

  it('normalises a Date month rather than assuming the driver returns a string', async () => {
    previousRows = [{ local_trust_score: 45, snapshot_month: new Date('2026-05-01T00:00:00.000Z') }]

    expect(await getPreviousLocalTrustBaseline({
      clientId: 'client-1', accountId: 'account-1', beforeMonth: '2026-06-01',
    })).toEqual({ score: 45, month: '2026-05-01' })
  })

  it.each([
    ['there is no earlier month', [] as unknown[]],
    ['the stored score cannot be read as a number', [{ local_trust_score: 'n/a', snapshot_month: '2026-05-01' }]],
  ])('returns null when %s', async (_label, rows) => {
    previousRows = rows

    expect(await getPreviousLocalTrustBaseline({
      clientId: 'client-1', accountId: 'account-1', beforeMonth: '2026-06-01',
    })).toBeNull()
  })
})

describe('getOrCreateLocalTrustSnapshot', () => {
  it('resolves the month, then reads the baseline, before it computes anything', async () => {
    await snapshotFor()

    // The month has to exist before the lookup can be scoped, and the lookup has
    // to happen before the score is computed — this is the ordering that makes the
    // real baseline possible at all.
    expect(queries[0]!.text).toContain('select local_trust_score, snapshot_month')
    expect(queries[0]!.values).toEqual(['client-1', 'account-1', '2026-06-01'])
    expect(queries[1]!.text).toContain('insert into local_trust_snapshots')
  })

  it('keys the figure to the stored score and reports how it got there', async () => {
    previousRows = [{ local_trust_score: '4.00', snapshot_month: '2026-05-01' }]

    const { draft, roi } = await snapshotFor()

    expect(roi.unavailable).toBeNull()
    expect(draft.roi_estimate).not.toBeNull()
    expect(draft.roi_estimate!.assumptions).toMatchObject({
      previousScore: 4,
      scoreDelta: draft.local_trust_score - 4,
      comparedToMonth: '2026-05-01',
      // The profile arrives from `numeric` columns as strings; what is stored must
      // not be '8000.00', because the panel and the CSV read these back.
      averageLeadValue: 8000,
      closeRate: 0.2,
    })
  })

  it('reports a first month as a first month, not as missing assumptions', async () => {
    // The owner has entered both figures. Telling them to enter them is the lie
    // this reason code exists to prevent.
    const { draft, roi } = await snapshotFor()

    expect(draft.roi_estimate).toBeNull()
    expect(roi).toEqual({ estimate: null, unavailable: 'no_earlier_snapshot' })
  })

  it('reports a score that did not rise as exactly that', async () => {
    const { draft } = await snapshotFor()
    previousRows = [{ local_trust_score: String(draft.local_trust_score), snapshot_month: '2026-05-01' }]
    queries.length = 0

    const { roi } = await snapshotFor()

    expect(roi).toEqual({ estimate: null, unavailable: 'no_increase' })
  })

  it('writes the same figure it explains', async () => {
    previousRows = [{ local_trust_score: '4.00', snapshot_month: '2026-05-01' }]

    const { draft, roi } = await snapshotFor()

    // The column and the explanation are computed by one function for exactly this
    // reason: a panel that says "no earlier month" over a stored figure, or the
    // reverse, is worse than either alone.
    const insert = queries.find(query => query.text.includes('insert into local_trust_snapshots'))!
    const written = insert.values.find(value => typeof value === 'string' && value.includes('"currency"'))

    expect(JSON.parse(written as string)).toEqual(roi.estimate)
    expect(roi.estimate).toEqual(draft.roi_estimate)
  })
})
