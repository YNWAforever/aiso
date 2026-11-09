import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

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
const brandA = '20000000-0000-4000-8000-000000000001'
const brandB = '20000000-0000-4000-8000-000000000002'
const brandC = '20000000-0000-4000-8000-000000000003'
const week = '2026-10-26'

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec('create table accounts(id uuid primary key);')
  await state.pg.exec('create table clients(id uuid primary key, account_id uuid not null, unique (id, account_id));')
  await state.pg.query('insert into accounts(id) values($1),($2)', [accountA, accountB])
  await state.pg.query('insert into clients(id, account_id) values($1,$2),($3,$2),($4,$5)', [brandA, accountA, brandB, brandC, accountB])
  await state.pg.exec(readFileSync('supabase/migrations/080_studio_live_weekly_usage.sql', 'utf8'))
  await state.pg.exec(readFileSync('supabase/migrations/102_studio_live_quota_per_brand.sql', 'utf8'))
})

beforeEach(async () => {
  vi.resetModules()
  state.statements = []
  await state.pg!.exec('delete from studio_live_weekly_usage;')
})

afterAll(async () => {
  await state.pg?.close()
})

it('counts LIVE answers per brand-week with the fixed cap of 10', async () => {
  const quota = await import('@/lib/conversation-studio/live-quota')
  expect(quota.studioLiveCap()).toBe(10)
  expect(await quota.reserveStudioAnswers(accountA, brandA, 4, week)).toEqual({ cap: 10, remaining: 6, scope: 'brand' })
  expect(await quota.reserveStudioAnswers(accountA, brandA, 6, week)).toEqual({ cap: 10, remaining: 0, scope: 'brand' })
  await expect(quota.reserveStudioAnswers(accountA, brandA, 1, week)).rejects.toThrow('STUDIO_QUOTA_EXCEEDED')

  const rows = await state.pg!.query(
    'select account_id, client_id, week_start::text, answer_count from studio_live_weekly_usage order by client_id',
  )
  expect(rows.rows).toEqual([{ account_id: accountA, client_id: brandA, week_start: week, answer_count: 10 }])
  expect(state.statements.every(({ text }) => text.includes('studio_live_weekly_usage'))).toBe(true)
})

it('gives each brand on one account its own allowance', async () => {
  const { reserveStudioAnswers } = await import('@/lib/conversation-studio/live-quota')
  expect((await reserveStudioAnswers(accountA, brandA, 10, week)).remaining).toBe(0)
  await expect(reserveStudioAnswers(accountA, brandA, 1, week)).rejects.toThrow('STUDIO_QUOTA_EXCEEDED')
  expect((await reserveStudioAnswers(accountA, brandB, 1, week)).remaining).toBe(9)
  expect((await state.pg!.query('select count(*)::int as count from studio_live_weekly_usage')).rows).toEqual([{ count: 2 }])
})

it('keeps accounts separate even for the same brand-week counter', async () => {
  const { reserveStudioAnswers } = await import('@/lib/conversation-studio/live-quota')
  expect((await reserveStudioAnswers(accountA, brandA, 10, week)).remaining).toBe(0)
  expect((await reserveStudioAnswers(accountB, brandC, 1, week)).remaining).toBe(9)
})

it('rejects invalid input and an over-cap fan-out before any counter query', async () => {
  const { reserveStudioAnswers } = await import('@/lib/conversation-studio/live-quota')
  for (const call of [
    () => reserveStudioAnswers(accountA, brandA, 11, week),
    () => reserveStudioAnswers(accountA, brandA, 0, week),
    () => reserveStudioAnswers('not-a-uuid', brandA, 1, week),
    () => reserveStudioAnswers(accountA, 'not-a-uuid', 1, week),
    () => reserveStudioAnswers(accountA, brandA, 1, '2026-10-26T00:00:00Z'),
  ]) {
    await expect(call()).rejects.toThrow('STUDIO_QUOTA_EXCEEDED')
  }
  expect(state.statements).toEqual([])
})

it('does not write past the cap when reservations race for one brand', async () => {
  const { reserveStudioAnswers } = await import('@/lib/conversation-studio/live-quota')
  const results = await Promise.allSettled([
    reserveStudioAnswers(accountA, brandA, 6, week),
    reserveStudioAnswers(accountA, brandA, 6, week),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  expect((await state.pg!.query(
    'select answer_count from studio_live_weekly_usage where account_id = $1 and client_id = $2 and week_start = $3::date',
    [accountA, brandA, week],
  )).rows).toEqual([{ answer_count: 6 }])
})

it('persists the brand-week across separate module loads', async () => {
  let quota = await import('@/lib/conversation-studio/live-quota')
  expect((await quota.reserveStudioAnswers(accountA, brandA, 1, week)).remaining).toBe(9)
  vi.resetModules()
  quota = await import('@/lib/conversation-studio/live-quota')
  expect((await quota.reserveStudioAnswers(accountA, brandA, 1, week)).remaining).toBe(8)
})

it('uses the UTC Monday boundary, so a new week starts with a fresh brand allowance', async () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
    const { reserveStudioAnswers, studioWeek } = await import('@/lib/conversation-studio/live-quota')
    expect(studioWeek()).toBe('2026-10-26')
    expect((await reserveStudioAnswers(accountA, brandA, 10, studioWeek())).remaining).toBe(0)
    await expect(reserveStudioAnswers(accountA, brandA, 1, studioWeek())).rejects.toThrow('STUDIO_QUOTA_EXCEEDED')
    vi.setSystemTime(new Date('2026-11-02T00:00:00Z'))
    expect(studioWeek()).toBe('2026-11-02')
    expect((await reserveStudioAnswers(accountA, brandA, 1, studioWeek())).remaining).toBe(9)
  } finally {
    vi.useRealTimers()
  }
})
