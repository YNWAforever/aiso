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
  state.statements = []
  await state.pg!.exec('delete from studio_firecrawl_brand_settings;')
})

afterAll(async () => {
  await state.pg?.close()
})

it('defaults the brand switch OFF and has no weekly usage counter', async () => {
  const { loadStudioFirecrawlBrandSettings } = await import('@/lib/conversation-studio/firecrawl-query')
  expect(await loadStudioFirecrawlBrandSettings(accountA, clientA, {})).toEqual({
    enabled: false,
    credentialsConfigured: false,
  })
  expect(await loadStudioFirecrawlBrandSettings(accountA, clientA, { FIRECRAWL_API_KEY: 'x' })).toEqual({
    enabled: false,
    credentialsConfigured: true,
  })
  const tables = await state.pg!.query(
    "select table_name from information_schema.tables where table_schema='public' and table_name like 'studio_firecrawl%'",
  )
  expect(tables.rows).toEqual([{ table_name: 'studio_firecrawl_brand_settings' }])
})

it('stores a toggle for the owning account only', async () => {
  const { loadStudioFirecrawlBrandSettings, setStudioFirecrawlBrandEnabled } = await import('@/lib/conversation-studio/firecrawl-query')
  await setStudioFirecrawlBrandEnabled({ accountId: accountA, clientId: clientA, enabled: true, updatedBy: profileA })
  expect((await loadStudioFirecrawlBrandSettings(accountA, clientA, {})).enabled).toBe(true)
  expect((await loadStudioFirecrawlBrandSettings(accountB, clientA, {})).enabled).toBe(false)
})

it('keeps RLS enabled and no policies on the new table', async () => {
  const rls = await state.pg!.query(
    "select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='studio_firecrawl_brand_settings'",
  )
  expect(rls.rows).toEqual([{ relrowsecurity: true }])
  const policies = await state.pg!.query(
    "select policyname from pg_policies where schemaname='public' and tablename='studio_firecrawl_brand_settings'",
  )
  expect(policies.rows).toEqual([])
})
