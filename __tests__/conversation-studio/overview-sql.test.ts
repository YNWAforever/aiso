import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ pg: null as PGlite | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    return (await state.pg!.query(text, values)).rows
  },
}))
import { loadStudioWeeks } from '@/lib/conversation-studio/overview'

const accountA = '10000000-0000-4000-8000-000000000001'
const accountB = '10000000-0000-4000-8000-000000000002'
const brandA = '30000000-0000-4000-8000-000000000001'
const brandB = '30000000-0000-4000-8000-000000000002'

beforeAll(async () => {
  state.pg = await PGlite.create()
  // Minimal shape: only the columns the statement reads.
  await state.pg.exec(`
    create table clients(id uuid primary key, account_id uuid not null);
    create table pulse_weekly_summary(client_id uuid not null, scan_week date not null, platform text, total_queries int, brand_mentions int, sov_score numeric);
  `)
  await state.pg.query('insert into clients values ($1,$2),($3,$4)', [brandA, accountA, brandB, accountB])
  const rows: [string, string, string | null, number, number, number][] = [
    [brandA, '2026-10-19', null, 40, 12, 30],
    [brandA, '2026-10-26', null, 40, 15, 37.5],
    [brandA, '2026-10-26', 'chatgpt', 20, 9, 45],
    [brandA, '2026-10-12', null, 10, 11, 110], // mentions > answers: incoherent, dropped
    [brandB, '2026-10-26', null, 40, 40, 100],
  ]
  for (const row of rows) await state.pg.query('insert into pulse_weekly_summary values ($1,$2,$3,$4,$5,$6)', row)
})
afterAll(async () => { await state.pg?.close() })

it('reads only the owned brand’s all-platform rows, newest first, dropping incoherent rows', async () => {
  expect(await loadStudioWeeks(accountA, brandA)).toEqual({ status: 'ok', data: [
    { week: '2026-10-26', sovScore: 37.5, brandMentions: 15, totalQueries: 40 },
    { week: '2026-10-19', sovScore: 30, brandMentions: 12, totalQueries: 40 },
  ] })
})

it('returns nothing for a brand of another account, rather than its rows', async () => {
  expect(await loadStudioWeeks(accountA, brandB)).toEqual({ status: 'empty' })
})
