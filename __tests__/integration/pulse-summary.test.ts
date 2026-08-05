import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { computeWeeklySummary } from '@/lib/pulse/summary'

const sql = neon(process.env.TEST_DATABASE_URL!)

const CLIENT = '55555555-5555-5555-5555-555555555555'
const ACCOUNT = '66666666-6666-6666-6666-666666666666'
const MONDAY = '2026-01-05'
const WEDNESDAY = '2026-01-07'   // same ISO week as MONDAY

/**
 * The rollup's correctness is a property of the SQL, not of the TypeScript
 * around it. A mocked `sql` can assert the statement mentions GROUPING SETS; it
 * cannot demonstrate that Postgres actually emits the `platform is null`
 * aggregate, that NULLS NOT DISTINCT dedupes it, or that a mid-week date lands
 * in the same bucket as its Monday. Those need a real database.
 */
async function seed() {
  await sql`delete from pulse_weekly_summary where client_id = ${CLIENT}`
  await sql`delete from pulse_metrics where client_id = ${CLIENT}`
  await sql`delete from clients where id = ${CLIENT}`
  await sql`delete from accounts where id = ${ACCOUNT}`
  await sql`insert into accounts (id, plan, status) values (${ACCOUNT}, 'pro', 'active')`
  await sql`
    insert into clients (id, account_id, brand_name, status, competitors)
    values (${CLIENT}, ${ACCOUNT}, 'Acme', 'active', ${[]}::text[])
  `
  // 2 platforms x 3 questions. gpt-4o mentions 2/3, gemini 1/3 → aggregate 3/6.
  await sql`
    insert into pulse_metrics (client_id, platform, question, brand_mentioned, sentiment, competitors_mentioned, scan_week)
    values
      (${CLIENT}, 'gpt-4o', 'q1', true,  'positive', ${['Rival', 'Other']}::text[], ${MONDAY}),
      (${CLIENT}, 'gpt-4o', 'q2', true,  'neutral',  ${['Rival']}::text[],          ${MONDAY}),
      (${CLIENT}, 'gpt-4o', 'q3', false, 'negative', ${['Other']}::text[],          ${MONDAY}),
      (${CLIENT}, 'gemini', 'q1', true,  'positive', ${['Rival']}::text[],          ${MONDAY}),
      (${CLIENT}, 'gemini', 'q2', false, 'negative', ${null},                       ${MONDAY}),
      (${CLIENT}, 'gemini', 'q3', false, 'neutral',  ${[]}::text[],                 ${MONDAY})
  `
}

const summaryRows = () => sql`
  select platform, total_queries, brand_mentions, sov_score, top_competitors
  from pulse_weekly_summary where client_id = ${CLIENT} order by platform nulls last
`

describe('pulse weekly summary rollup', () => {
  beforeEach(seed)

  it('writes one row per platform plus the aggregate row nothing else produces', async () => {
    const result = await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })

    expect(result).toMatchObject({ scanWeek: MONDAY, platformRows: 2, aggregateRows: 1 })

    const rows = await summaryRows()
    const aggregate = rows.find(r => r.platform === null)!
    expect(Number(aggregate.total_queries)).toBe(6)
    expect(Number(aggregate.brand_mentions)).toBe(3)
    expect(Number(aggregate.sov_score)).toBe(50)
  })

  it('keeps the aggregate consistent with the per-platform rows it sums', async () => {
    await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })
    const rows = await summaryRows()

    const platforms = rows.filter(r => r.platform !== null)
    const aggregate = rows.find(r => r.platform === null)!
    const summed = platforms.reduce((n, r) => n + Number(r.total_queries), 0)

    expect(summed).toBe(Number(aggregate.total_queries))
  })

  it('refreshes rather than duplicating on a re-run', async () => {
    // The property migration 031 exists for. Without NULLS NOT DISTINCT the
    // aggregate would append a second copy each time, and evaluate-alerts would
    // then compare a week against itself and compute a 0% delta forever.
    await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })
    await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })

    const rows = await summaryRows()
    expect(rows).toHaveLength(3)
    expect(rows.filter(r => r.platform === null)).toHaveLength(1)
  })

  it('picks up changed metrics on a re-run instead of keeping stale numbers', async () => {
    await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })
    await sql`update pulse_metrics set brand_mentioned = true where client_id = ${CLIENT} and platform = 'gemini'`
    await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })

    const rows = await summaryRows()
    const aggregate = rows.find(r => r.platform === null)!
    expect(Number(aggregate.brand_mentions)).toBe(5)
  })

  it('buckets a mid-week date into the same ISO week as its Monday', async () => {
    await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })
    await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: WEDNESDAY })

    const weeks = await sql`
      select distinct scan_week from pulse_weekly_summary where client_id = ${CLIENT}
    `
    expect(weeks).toHaveLength(1)
  })

  it('tallies competitors per platform and in the aggregate', async () => {
    await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })
    const rows = await summaryRows()

    const aggregate = rows.find(r => r.platform === null)!
    // Rival appears in 2 gpt-4o answers and 1 gemini answer.
    expect(aggregate.top_competitors).toMatchObject({ Rival: 3, Other: 2 })
  })

  it('does not let unnesting competitors inflate the query totals', async () => {
    // q1 carries two competitors; a naive unnest in the main aggregate would
    // count that answer twice.
    await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })
    const rows = await summaryRows()

    expect(Number(rows.find(r => r.platform === 'gpt-4o')!.total_queries)).toBe(3)
  })
})
