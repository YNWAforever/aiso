import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  pg: null as PGlite | null,
  statements: [] as Array<{ text: string; values: unknown[] }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    state.statements.push({ text, values })
    return (await state.pg!.query(text, values)).rows
  },
}))

const accountA = '10000000-0000-4000-8000-000000000001'
const accountB = '10000000-0000-4000-8000-000000000002'
const week = '2026-10-26'

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec('create table accounts(id uuid primary key);')
  await state.pg.query('insert into accounts(id) values($1),($2)', [accountA, accountB])
  await state.pg.exec(readFileSync('supabase/migrations/080_studio_live_weekly_usage.sql', 'utf8'))
})

beforeEach(async () => {
  vi.resetModules()
  state.statements = []
  await state.pg!.exec('delete from studio_live_weekly_usage;')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await state.pg?.close()
})

it('persists an account-week across separate module loads and rejects the next answer', async () => {
  vi.stubEnv('STUDIO_LIVE_ANSWERS_PER_WEEK', '2')
  let quota = await import('@/lib/conversation-studio/live-quota')
  expect(await quota.reserveStudioAnswers(accountA, 1, week)).toEqual({
    cap: 2,
    remaining: 1,
    scope: 'account',
  })

  vi.resetModules()
  quota = await import('@/lib/conversation-studio/live-quota')
  expect(await quota.reserveStudioAnswers(accountA, 1, week)).toEqual({
    cap: 2,
    remaining: 0,
    scope: 'account',
  })
  await expect(quota.reserveStudioAnswers(accountA, 1, week)).rejects.toThrow('STUDIO_QUOTA_EXCEEDED')

  const rows = await state.pg!.query(
    'select account_id, week_start::text, answer_count from studio_live_weekly_usage order by account_id',
  )
  expect(rows.rows).toEqual([{ account_id: accountA, week_start: week, answer_count: 2 }])
  expect(state.statements.every(({ text }) => text.includes('studio_live_weekly_usage'))).toBe(true)
  expect(state.statements.every(({ values }) => values[0] === accountA)).toBe(true)
})

it('isolates counters by account even when another account used the same week', async () => {
  vi.stubEnv('STUDIO_LIVE_ANSWERS_PER_WEEK', '1')
  const { reserveStudioAnswers } = await import('@/lib/conversation-studio/live-quota')

  expect((await reserveStudioAnswers(accountA, 1, week)).remaining).toBe(0)
  await expect(reserveStudioAnswers(accountA, 1, week)).rejects.toThrow('STUDIO_QUOTA_EXCEEDED')
  expect((await reserveStudioAnswers(accountB, 1, week)).remaining).toBe(0)

  const rows = await state.pg!.query(
    'select account_id, answer_count from studio_live_weekly_usage order by account_id',
  )
  expect(rows.rows).toEqual([
    { account_id: accountA, answer_count: 1 },
    { account_id: accountB, answer_count: 1 },
  ])
})

it('rejects cap zero before the counter query', async () => {
  vi.stubEnv('STUDIO_LIVE_ANSWERS_PER_WEEK', '0')
  const { reserveStudioAnswers } = await import('@/lib/conversation-studio/live-quota')

  await expect(reserveStudioAnswers(accountA, 1, week)).rejects.toThrow('STUDIO_QUOTA_EXCEEDED')
  expect(state.statements).toEqual([])
  expect((await state.pg!.query('select count(*)::int as count from studio_live_weekly_usage')).rows)
    .toEqual([{ count: 0 }])
})

it('does not write past the cap when reservations race', async () => {
  vi.stubEnv('STUDIO_LIVE_ANSWERS_PER_WEEK', '1')
  const { reserveStudioAnswers } = await import('@/lib/conversation-studio/live-quota')

  const results = await Promise.allSettled([
    reserveStudioAnswers(accountA, 1, week),
    reserveStudioAnswers(accountA, 1, week),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  expect((await state.pg!.query(
    'select answer_count from studio_live_weekly_usage where account_id = $1 and week_start = $2::date',
    [accountA, week],
  )).rows).toEqual([{ answer_count: 1 }])
})
