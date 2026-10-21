import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import {
  consumeAuthenticatedScanQuota,
  releaseAuthenticatedScanQuota,
  type AuthenticatedScanQuotaDecision,
} from '@/lib/security/authenticated-scan-quota'

// This store test has no Neon client or connection string. The mocked tagged
// template executes only on a new, in-memory PostgreSQL instance owned here.
const h = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: () => h.sql }))

let pg: PGlite
let accountId: string
let foreignAccountId: string
let currentMonth: string
let previousMonth: string
let previousPeriodResetAt: number

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('create table accounts (id uuid primary key)')
  await pg.exec(readFileSync('supabase/migrations/025_authenticated_scan_quotas.sql', 'utf8'))
})

afterAll(async () => { await pg.close() })

beforeEach(async () => {
  accountId = randomUUID()
  foreignAccountId = randomUUID()
  await pg.query('insert into accounts (id) values ($1), ($2)', [accountId, foreignAccountId])
  const period = (await pg.query<{ current_month: string; previous_month: string; reset_at: string }>(`
    select date_trunc('month', now() at time zone 'UTC')::date::text as current_month,
      (date_trunc('month', now() at time zone 'UTC') - interval '1 month')::date::text as previous_month,
      extract(epoch from (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'))::bigint::text as reset_at
  `)).rows[0]!
  currentMonth = period.current_month
  previousMonth = period.previous_month
  previousPeriodResetAt = Number(period.reset_at)
  h.sql.mockReset()
  h.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '')
    return (await pg.query(query, values)).rows
  })
})

async function count(id = accountId, month = currentMonth): Promise<number | null> {
  const result = await pg.query<{ request_count: number }>(
    'select request_count from authenticated_scan_monthly_usage where account_id=$1 and month_start=$2',
    [id, month],
  )
  return result.rows[0]?.request_count ?? null
}

describe('authenticated scan quota on isolated in-memory PostgreSQL', () => {
  it('restores the last slot after an admitted scan fails despite intervening denied requests', async () => {
    await consumeAuthenticatedScanQuota(accountId)
    await consumeAuthenticatedScanQuota(accountId)
    const inFlight = await consumeAuthenticatedScanQuota(accountId)
    expect(inFlight).toMatchObject({ allowed: true, remaining: 0 })

    const denied = await consumeAuthenticatedScanQuota(accountId)
    expect(denied).toMatchObject({ allowed: false, remaining: 0 })
    expect(await count()).toBe(3)

    await releaseAuthenticatedScanQuota(accountId, inFlight)
    expect(await count()).toBe(2)
    const retry = await consumeAuthenticatedScanQuota(accountId)
    expect(retry).toMatchObject({ allowed: true, remaining: 0 })
    expect(await count()).toBe(3)
  })

  it('admits only the limit for requests submitted together and never increments on denial', async () => {
    const decisions = await Promise.all(Array.from({ length: 8 }, () => consumeAuthenticatedScanQuota(accountId)))
    expect(decisions.filter(decision => decision.allowed)).toHaveLength(3)
    expect(decisions.filter(decision => !decision.allowed)).toHaveLength(5)
    expect(await count()).toBe(3)
    expect(new Set(decisions.map(decision => decision.resetAt)).size).toBe(1)
    expect(decisions.every(decision => decision.remaining >= 0)).toBe(true)
  })

  it('refunds the reservation month after a UTC month boundary without reducing this month', async () => {
    await pg.query('insert into authenticated_scan_monthly_usage values ($1,$2,3),($1,$3,1)', [accountId, previousMonth, currentMonth])
    const previousReservation = { allowed: true, resetAt: previousPeriodResetAt }
    await releaseAuthenticatedScanQuota(accountId, previousReservation)
    expect(await count(accountId, previousMonth)).toBe(2)
    expect(await count(accountId, currentMonth)).toBe(1)
  })

  it('leaves every other account untouched on consumption, retention cleanup, and refund', async () => {
    await pg.query("insert into authenticated_scan_monthly_usage values ($1,$2,2),($1,'2000-01-01',1)", [foreignAccountId, currentMonth])
    const receipt = await consumeAuthenticatedScanQuota(accountId)
    await releaseAuthenticatedScanQuota(accountId, receipt)
    expect(await count(accountId)).toBeNull()
    expect(await count(foreignAccountId)).toBe(2)
    expect(await count(foreignAccountId, '2000-01-01')).toBe(1)
  })

  it('floors refunds at zero and never creates a missing reservation period', async () => {
    const receipt = await consumeAuthenticatedScanQuota(accountId)
    await releaseAuthenticatedScanQuota(accountId, receipt)
    await releaseAuthenticatedScanQuota(accountId, receipt)
    expect(await count()).toBeNull()
    await releaseAuthenticatedScanQuota(foreignAccountId, receipt)
    expect(await count(foreignAccountId)).toBeNull()
    expect(await consumeAuthenticatedScanQuota(accountId)).toMatchObject({ allowed: true, remaining: 2 })
    expect(await count()).toBe(1)
  })

  // PGlite serializes statements on one session. Exercise both legal orderings
  // at the delete boundary without claiming a multi-connection contention test.
  it.each(['refund-first', 'consume-first'] as const)('retains the new scan across the last refund: %s', async order => {
    const original = await consumeAuthenticatedScanQuota(accountId)
    if (order === 'refund-first') {
      await releaseAuthenticatedScanQuota(accountId, original)
      expect((await consumeAuthenticatedScanQuota(accountId)).allowed).toBe(true)
    } else {
      expect((await consumeAuthenticatedScanQuota(accountId)).allowed).toBe(true)
      await releaseAuthenticatedScanQuota(accountId, original)
    }
    expect(await count()).toBe(1)
  })

  it.each([
    { allowed: false, resetAt: 1793491200 },
    { allowed: true, resetAt: Number.NaN },
    { allowed: true, resetAt: 1793491200.5 },
    { allowed: true, resetAt: 1793491201 },
    { allowed: true, resetAt: Number.MAX_SAFE_INTEGER },
  ])('rejects an invalid or denied reservation before executing SQL: %j', async receipt => {
    await expect(releaseAuthenticatedScanQuota(accountId, receipt as Pick<AuthenticatedScanQuotaDecision, 'allowed' | 'resetAt'>)).rejects.toThrow()
    expect(h.sql).not.toHaveBeenCalled()
  })
})
