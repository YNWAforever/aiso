import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { archiveCompetitor, createCompetitor, listCompetitors, updateCompetitor } from '@/lib/competitors/store'

/**
 * Competitors (061) against real Postgres. The route tests prove the gate and
 * the statement order; only the database can prove the partial unique index,
 * `on conflict do nothing`, the array sync/mirror and the backfill.
 */

const sql = neon(process.env.TEST_DATABASE_URL!)
const ACCOUNT = 'c3000000-0000-4000-8000-000000000001'
const OTHER = 'c3000000-0000-4000-8000-000000000002'
const CLIENT = 'c3000000-0000-4000-8000-000000000003'
const BACKFILL_CLIENT = 'c3000000-0000-4000-8000-000000000004'
const input = (name: string) => ({ name, aliases: [], domains: [] })
const arrayOf = async (clientId: string) =>
  ((await sql`select competitors from clients where id = ${clientId}::uuid`)[0]?.competitors ?? []) as string[]

beforeAll(async () => {
  const [identity] = await sql`select current_setting('neon.project_id') as project`
  expect(identity.project).toBe(process.env.EXPECTED_NEON_PROJECT_ID)
})

beforeEach(async () => {
  await sql`delete from competitors where account_id in (${ACCOUNT}::uuid, ${OTHER}::uuid)`
  await sql`delete from clients where account_id in (${ACCOUNT}::uuid, ${OTHER}::uuid)`
  for (const account of [ACCOUNT, OTHER]) {
    await sql`delete from accounts where id = ${account}::uuid`
    await sql`insert into accounts (id, plan, status) values (${account}::uuid, 'basic', 'active')`
  }
  await sql`insert into clients (id, account_id, brand_name, domain, competitors)
            values (${CLIENT}::uuid, ${ACCOUNT}::uuid, 'C3 fixture', 'example.com', '{}'::text[])`
})

describe('competitors store', () => {
  it('creates, refuses a case-insensitive duplicate, and mirrors live names into the array', async () => {
    expect(await createCompetitor(sql as never, ACCOUNT, CLIENT, { name: 'Acme', aliases: ['Acme Co'], domains: ['acme.com'] }))
      .toMatchObject({ status: 'created', competitor: { name: 'Acme', aliases: ['Acme Co'], domains: ['acme.com'] } })
    expect(await createCompetitor(sql as never, ACCOUNT, CLIENT, input('ACME'))).toEqual({ status: 'exists' })
    expect(await arrayOf(CLIENT)).toEqual(['Acme'])
  })

  it('copies array-only names into the table before mirroring, so onboarding additions survive an edit', async () => {
    await sql`update clients set competitors = array['Globex', 'globex', ' '] where id = ${CLIENT}::uuid`
    await createCompetitor(sql as never, ACCOUNT, CLIENT, input('Acme'))
    const listed = (await listCompetitors(sql as never, ACCOUNT, CLIENT))!
    expect(listed.map(c => c.name).sort()).toEqual(['Acme', 'Globex'])
    expect(listed.every(c => c.id !== null)).toBe(true)
    expect((await arrayOf(CLIENT)).sort()).toEqual(['Acme', 'Globex'])
  })

  it('lists array-only names as unsaved entries without writing', async () => {
    await sql`update clients set competitors = array['Initech'] where id = ${CLIENT}::uuid`
    expect(await listCompetitors(sql as never, ACCOUNT, CLIENT)).toEqual([
      { id: null, name: 'Initech', aliases: [], domains: [], created_at: null, updated_at: null },
    ])
    expect(await sql`select 1 from competitors where client_id = ${CLIENT}::uuid`).toHaveLength(0)
  })

  it('refuses the eleventh live competitor', async () => {
    for (let i = 0; i < 10; i++) expect((await createCompetitor(sql as never, ACCOUNT, CLIENT, input(`Brand ${i}`))).status).toBe('created')
    expect(await createCompetitor(sql as never, ACCOUNT, CLIENT, input('Brand 10'))).toEqual({ status: 'limit' })
  })

  it('updates only the fields sent and refuses a rename onto a live name', async () => {
    const acme = await createCompetitor(sql as never, ACCOUNT, CLIENT, { name: 'Acme', aliases: ['AC'], domains: [] })
    await createCompetitor(sql as never, ACCOUNT, CLIENT, input('Globex'))
    const id = acme.status === 'created' ? acme.competitor.id! : ''
    expect(await updateCompetitor(sql as never, ACCOUNT, CLIENT, id, { domains: ['acme.com'] }))
      .toMatchObject({ status: 'updated', competitor: { name: 'Acme', aliases: ['AC'], domains: ['acme.com'] } })
    expect(await updateCompetitor(sql as never, ACCOUNT, CLIENT, id, { name: 'globex' })).toEqual({ status: 'exists' })
  })

  it('archives instead of deleting, drops the name from the array, and allows re-adding it', async () => {
    const created = await createCompetitor(sql as never, ACCOUNT, CLIENT, input('Acme'))
    const id = created.status === 'created' ? created.competitor.id! : ''
    expect(await archiveCompetitor(sql as never, ACCOUNT, CLIENT, id)).toBe(true)
    expect(await listCompetitors(sql as never, ACCOUNT, CLIENT)).toEqual([])
    expect(await arrayOf(CLIENT)).toEqual([])
    expect(await sql`select archived_at from competitors where id = ${id}::uuid`).toHaveLength(1)
    expect((await createCompetitor(sql as never, ACCOUNT, CLIENT, input('Acme'))).status).toBe('created')
    expect(await archiveCompetitor(sql as never, ACCOUNT, CLIENT, id)).toBe(false)
  })

  it('never reads or writes another account\'s client', async () => {
    const created = await createCompetitor(sql as never, ACCOUNT, CLIENT, input('Acme'))
    const id = created.status === 'created' ? created.competitor.id! : ''
    expect(await listCompetitors(sql as never, OTHER, CLIENT)).toBeNull()
    expect(await createCompetitor(sql as never, OTHER, CLIENT, input('Globex'))).toEqual({ status: 'not_found' })
    expect(await updateCompetitor(sql as never, OTHER, CLIENT, id, { name: 'Hijack' })).toEqual({ status: 'not_found' })
    expect(await archiveCompetitor(sql as never, OTHER, CLIENT, id)).toBe(false)
    expect((await listCompetitors(sql as never, ACCOUNT, CLIENT))!.map(c => c.name)).toEqual(['Acme'])
  })
})

describe('061 backfill', () => {
  it('copies trimmed, de-duplicated names, first spelling wins, at most ten per brand', async () => {
    const names = [' Acme ', 'acme', '', 'Globex', ...Array.from({ length: 12 }, (_, i) => `Brand ${i}`)]
    // A basic account holds one brand (BRAND_LIMIT_REACHED), and ACCOUNT's is CLIENT.
    await sql`insert into clients (id, account_id, brand_name, domain, competitors)
              values (${BACKFILL_CLIENT}::uuid, ${OTHER}::uuid, 'Backfill', 'backfill.example', ${names}::text[])`
    const migration = readFileSync('supabase/migrations/061_competitors.sql', 'utf8')
    const backfill = migration.slice(migration.indexOf('with names as'))
    await sql.query(backfill)
    await sql.query(backfill) // idempotent: a second run adds nothing
    const rows = await sql`select name from competitors where client_id = ${BACKFILL_CLIENT}::uuid order by name`
    expect(rows).toHaveLength(10)
    expect(rows.map(r => r.name)).toEqual(expect.arrayContaining(['Acme', 'Globex']))
    expect(rows.map(r => r.name)).not.toContain('acme')
  })
})
