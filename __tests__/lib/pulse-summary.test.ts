import { describe, it, expect } from 'vitest'
import { computeWeeklySummary } from '@/lib/pulse/summary'

const queries: string[] = []
let nextRows: unknown[] = []

function fakeSql(strings: TemplateStringsArray) {
  queries.push(strings.join('?'))
  return Promise.resolve(nextRows)
}

const sql = fakeSql as unknown as Parameters<typeof computeWeeklySummary>[0]

async function run(rows: unknown[] = []) {
  queries.length = 0
  nextRows = rows
  return computeWeeklySummary(sql, { clientId: 'client-1', scanWeek: '2026-01-07' })
}

describe('computeWeeklySummary', () => {
  it('writes per-platform and aggregate rows from one statement', async () => {
    // The whole point of GROUPING SETS here: two grouping levels in a single
    // pass, so the aggregate cannot drift from the per-platform rows it sums.
    await run()
    const [statement] = queries

    expect(queries).toHaveLength(1)
    expect(statement).toMatch(/group by grouping sets/i)
    expect(statement).toMatch(/\(client_id, scan_week, platform\)/)
    expect(statement).toMatch(/\(client_id, scan_week\)/)
  })

  it('upserts on the migration 031 constraint instead of appending', async () => {
    await run()

    expect(queries[0]).toMatch(/on conflict \(client_id, scan_week, platform\) do update/i)
  })

  it('normalises scan_week to the ISO week start on both read and write', async () => {
    // Two producers previously disagreed — one wrote today, the other now-7d.
    // Neither is a week boundary, which breaks the upsert and makes the
    // week-over-week alert compare a week against itself.
    await run()

    expect(queries[0]).toMatch(/date_trunc\('week'/)
  })

  it('joins competitor tallies with `is not distinct from` so the aggregate matches', async () => {
    // A plain `=` join drops the aggregate's competitors, because NULL = NULL
    // is unknown rather than true.
    await run()

    expect(queries[0]).toMatch(/platform is not distinct from/i)
  })

  it('counts competitors in a separate grouping so unnest cannot inflate totals', async () => {
    const [statement] = queries.length ? queries : (await run(), queries)

    expect(statement).toMatch(/competitor_tallies/)
    // unnest must not appear in the same FROM as the total_queries count.
    const rolled = statement.slice(statement.indexOf('rolled as'))
    expect(rolled).not.toMatch(/unnest/)
  })

  it('reports how many rows of each kind were written', async () => {
    const result = await run([
      { scan_week: '2026-01-05', platform: 'gpt-4o' },
      { scan_week: '2026-01-05', platform: 'gemini' },
      { scan_week: '2026-01-05', platform: null },
    ])

    expect(result).toEqual({ scanWeek: '2026-01-05', platformRows: 2, aggregateRows: 1 })
  })

  it('renders a driver-supplied Date as an ISO date, not a locale sentence', async () => {
    // Why this fake had to change: the HTTP driver returns a `date` as a string,
    // but the WebSocket/`Client` driver parses it into a Date, and this value is
    // returned straight out of POST /api/pulse/run. `String(new Date(...))` gave
    // "Mon Jan 05 2026 00:00:00 GMT+0800 (Hong Kong Standard Time)" — a field
    // whose content moved with the server's timezone and locale. The integration
    // suite caught it because it runs the driver that parses; this suite could
    // not, because the fake only ever returned what the other driver returns.
    //
    // `new Date(y, m, d)` is local midnight, which is what the driver builds for
    // a zoneless Postgres `date`. The shape assertion is the timezone-independent
    // half; the equality pins that isoDate() renders that Date as the expected
    // calendar-day string. It does NOT by itself distinguish local components
    // from `toISOString()` -- at TZ=UTC (this suite's default, and CI's) the two
    // agree exactly. The positive-offset shift is what __tests__/lib/iso-date.test.ts
    // guards, and that file pins TZ itself so the two implementations diverge.
    const result = await run([{ scan_week: new Date(2026, 0, 5), platform: null }])

    expect(result.scanWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(result.scanWeek).toBe('2026-01-05')
  })

  it('reports zero rather than throwing when the week has no metrics', async () => {
    const result = await run([])

    expect(result.platformRows).toBe(0)
    expect(result.aggregateRows).toBe(0)
  })
})
