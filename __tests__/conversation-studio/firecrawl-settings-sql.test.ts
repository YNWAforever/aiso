import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ pg: null as PGlite | null }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    return (await state.pg!.query(text, values)).rows
  },
}))

const accountA = '10000000-0000-4000-8000-000000000001'
const accountB = '10000000-0000-4000-8000-000000000002'
const clientA = '20000000-0000-4000-8000-000000000001'
const clientB = '20000000-0000-4000-8000-000000000002'
const profileA = '30000000-0000-4000-8000-000000000001'

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
  await state.pg.exec(readFileSync('supabase/migrations/083_studio_firecrawl.sql', 'utf8'))
})

beforeEach(async () => {
  vi.resetModules()
  await state.pg!.exec('delete from studio_firecrawl_brand_settings')
})

afterAll(async () => { await state.pg?.close() })

it('creates only the settings table with RLS on and no usage table', async () => {
  const rows = (await state.pg!.query<{ relname: string; relrowsecurity: boolean }>(
    `select relname, relrowsecurity from pg_class where relname like 'studio_firecrawl%' and relkind = 'r'`,
  )).rows
  expect(rows).toEqual([{ relname: 'studio_firecrawl_brand_settings', relrowsecurity: true }])
})

it('defaults OFF and stores the switch per owning account', async () => {
  const { loadStudioFirecrawlBrandSettings, setStudioFirecrawlBrandEnabled } = await import('@/lib/conversation-studio/firecrawl-query')
  expect(await loadStudioFirecrawlBrandSettings(accountA, clientA, {})).toEqual({ enabled: false, keyConfigured: false })
  await setStudioFirecrawlBrandEnabled({ accountId: accountA, clientId: clientA, enabled: true, updatedBy: profileA })
  expect(await loadStudioFirecrawlBrandSettings(accountA, clientA, { FIRECRAWL_API_KEY: 'k' })).toEqual({ enabled: true, keyConfigured: true })
  // Another account reading the same brand id sees nothing.
  expect((await loadStudioFirecrawlBrandSettings(accountB, clientA, {})).enabled).toBe(false)
  await setStudioFirecrawlBrandEnabled({ accountId: accountA, clientId: clientA, enabled: false, updatedBy: profileA })
  expect((await loadStudioFirecrawlBrandSettings(accountA, clientA, {})).enabled).toBe(false)
})

it('rejects a write that pairs a brand with a foreign account', async () => {
  const { setStudioFirecrawlBrandEnabled } = await import('@/lib/conversation-studio/firecrawl-query')
  await expect(setStudioFirecrawlBrandEnabled({ accountId: accountA, clientId: clientB, enabled: true, updatedBy: profileA }))
    .rejects.toThrow()
})
