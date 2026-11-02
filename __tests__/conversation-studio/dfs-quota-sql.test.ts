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
const clientA = '20000000-0000-4000-8000-000000000001'
const clientB = '20000000-0000-4000-8000-000000000002'
const profileA = '30000000-0000-4000-8000-000000000001'
const week = '2026-11-02'

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table accounts(id uuid primary key);
    create table profiles(id uuid primary key, account_id uuid, unique (id, account_id));
    create table clients(id uuid primary key, account_id uuid, unique (id, account_id));
  `)
  await state.pg.query('insert into accounts(id) values($1),($2)', [accountA, accountB])
  await state.pg.query('insert into profiles(id, account_id) values($1,$2)', [profileA, accountA])
  await state.pg.query('insert into clients(id, account_id) values($1,$2),($3,$4)', [clientA, accountA, clientB, accountB])
  await state.pg.exec(readFileSync('supabase/migrations/082_studio_dataforseo.sql', 'utf8'))
})

beforeEach(async () => {
  vi.resetModules()
  state.statements = []
  await state.pg!.exec('delete from studio_dataforseo_weekly_usage; delete from studio_dataforseo_brand_settings;')
})

afterAll(async () => {
  await state.pg?.close()
})

it('allows the 20th call and caps the 21st without writing past the brand-week cap', async () => {
  const { reserveStudioDfsCall } = await import('@/lib/conversation-studio/dfs-query')
  for (let call = 1; call <= 20; call += 1) {
    const decision = await reserveStudioDfsCall(accountA, clientA, week)
    expect(decision).toEqual({ allowed: true, remaining: 20 - call })
  }
  expect(await reserveStudioDfsCall(accountA, clientA, week)).toEqual({ allowed: false, remaining: 0 })
  expect((await state.pg!.query(
    'select call_count from studio_dataforseo_weekly_usage where client_id = $1 and week_start = $2::date',
    [clientA, week],
  )).rows).toEqual([{ call_count: 20 }])
  expect(state.statements.every(({ text }) => text.includes('studio_dataforseo_weekly_usage'))).toBe(true)
})

it('isolates the counter by brand even inside one account', async () => {
  const { reserveStudioDfsCall } = await import('@/lib/conversation-studio/dfs-query')
  for (let call = 1; call <= 20; call += 1) await reserveStudioDfsCall(accountA, clientA, week)
  expect((await reserveStudioDfsCall(accountA, clientA, week)).allowed).toBe(false)
  expect((await reserveStudioDfsCall(accountB, clientB, week)).allowed).toBe(true)
  const rows = await state.pg!.query(
    'select client_id, call_count from studio_dataforseo_weekly_usage order by client_id',
  )
  expect(rows.rows).toEqual([
    { client_id: clientA, call_count: 20 },
    { client_id: clientB, call_count: 1 },
  ])
})

it('defaults the brand switch OFF and stores a toggle for the owning account', async () => {
  const { loadStudioDfsBrandSettings, setStudioDfsBrandEnabled } = await import('@/lib/conversation-studio/dfs-query')
  expect((await loadStudioDfsBrandSettings(accountA, clientA, {})).enabled).toBe(false)
  await setStudioDfsBrandEnabled({ accountId: accountA, clientId: clientA, enabled: true, updatedBy: profileA })
  expect((await loadStudioDfsBrandSettings(accountA, clientA, {})).enabled).toBe(true)
  expect((await loadStudioDfsBrandSettings(accountB, clientA, {})).enabled).toBe(false)
})

it('does not write past the cap when reservations race', async () => {
  const { reserveStudioDfsCall } = await import('@/lib/conversation-studio/dfs-query')
  for (let call = 1; call <= 19; call += 1) await reserveStudioDfsCall(accountA, clientA, week)
  const results = await Promise.allSettled([
    reserveStudioDfsCall(accountA, clientA, week),
    reserveStudioDfsCall(accountA, clientA, week),
  ])
  expect(results.filter(result => result.status === 'fulfilled' && result.value.allowed)).toHaveLength(1)
  expect((await state.pg!.query(
    'select call_count from studio_dataforseo_weekly_usage where client_id = $1 and week_start = $2::date',
    [clientA, week],
  )).rows).toEqual([{ call_count: 20 }])
})
