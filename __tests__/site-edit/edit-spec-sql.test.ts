import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ pg: null as PGlite | null }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => {
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    return (await state.pg!.query(text, values)).rows
  }
  // updateOwnedDraft runs [mutation, replay] via sql.transaction; replay each in order.
  const db = () => Object.assign(tag, {
    transaction: async (queries: Array<Promise<unknown>>) => Promise.all(queries),
  })
  return { db }
})

import { draft } from '../change-sets/fixtures'
import { parseEditSpec } from '@/lib/site-edit/edit-spec'

const account = '10000000-0000-4000-8000-000000000001'
const client = '20000000-0000-4000-8000-000000000001'
const item = '30000000-0000-4000-8000-000000000001'
const spec = parseEditSpec({
  schemaVersion: 1, kind: 'jsonld', targetUrl: 'https://www.example.com/', schemaType: 'Organization',
  payload: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Example Bakery' },
})

beforeAll(async () => {
  state.pg = await PGlite.create()
  // Minimal shapes of 041's evidence_work_items and 042's work_item_versions:
  // only the columns the real statements below read or write.
  await state.pg.exec(`
    create table clients(id uuid primary key, account_id uuid not null);
    create table evidence_work_items(
      id uuid primary key, account_id uuid not null, client_id uuid not null,
      source_kind text not null, status text not null default 'draft',
      title text not null, action text not null, notes text not null, locale text not null,
      revision bigint not null default 1, updated_by uuid,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      evidence_snapshot jsonb not null
    );
    create table work_item_versions(id uuid primary key, content jsonb not null);
  `)
  await state.pg.query('insert into clients(id, account_id) values ($1, $2)', [client, account])
  await state.pg.exec(readFileSync('supabase/migrations/086_work_item_edit_specs.sql', 'utf8'))
})

beforeEach(async () => {
  vi.resetModules()
  await state.pg!.exec('delete from evidence_work_items')
  await state.pg!.query(
    `insert into evidence_work_items (id, account_id, client_id, source_kind, title, action, notes, locale, evidence_snapshot)
     values ($1, $2, $3, 'pulse-metric', 'Title', 'Action', '', 'en', $4::jsonb)`,
    [item, account, client, JSON.stringify(draft().evidenceSnapshot)],
  )
})

afterAll(async () => { await state.pg?.close() })

const store = () => import('@/lib/work-items/store')
const edit = (expectedRevision: number, extra: Record<string, unknown> = {}) =>
  ({ title: 'Title', action: 'Action', notes: '', expectedRevision, ...extra })

it('stores, keeps (absent), replaces and clears a spec through the real statements', async () => {
  const { updateOwnedDraft, readOwnedDraft } = await store()
  expect((await readOwnedDraft(account, client, item))!.editSpec).toBeNull()

  const set = await updateOwnedDraft(account, client, item, null, edit(1, { editSpec: spec }))
  expect(set).toMatchObject({ revision: 2, editSpec: spec })

  const kept = await updateOwnedDraft(account, client, item, null, edit(2, { notes: 'more' }))
  expect(kept).toMatchObject({ revision: 3, editSpec: spec })

  const cleared = await updateOwnedDraft(account, client, item, null, edit(3, { notes: 'more', editSpec: null }))
  expect(cleared).toMatchObject({ revision: 4, editSpec: null })
  expect((await readOwnedDraft(account, client, item))!.editSpec).toBeNull()
})

it('replays an identical retry only when the spec matches too', async () => {
  const { updateOwnedDraft } = await store()
  await updateOwnedDraft(account, client, item, null, edit(1, { editSpec: spec }))
  // Same request again at the old revision: the replay branch returns the saved row.
  expect(await updateOwnedDraft(account, client, item, null, edit(1, { editSpec: spec }))).toMatchObject({ revision: 2, editSpec: spec })
  // Same text but a different spec is a conflict, not a replay.
  const other = { ...spec, targetUrl: 'https://www.example.com/about' }
  expect(await updateOwnedDraft(account, client, item, null, edit(1, { editSpec: other }))).toBeNull()
})

it('enforces the draft spec floor in the database', async () => {
  const bad = (value: unknown) => state.pg!.query('update evidence_work_items set edit_spec = $1::jsonb where id = $2', [JSON.stringify(value), item])
  await expect(bad({ ...spec, targetUrl: 'http://www.example.com/' })).rejects.toThrow()
  await expect(bad({ ...spec, kind: 'html' })).rejects.toThrow()
  await expect(bad({ ...spec, schemaType: 'Product' })).rejects.toThrow()
  await expect(bad({ ...spec, payload: { ...spec.payload, '@type': 'FAQPage' } })).rejects.toThrow()
  await expect(bad({ ...spec, payload: { ...spec.payload, filler: 'x'.repeat(21000) } })).rejects.toThrow()
  await expect(bad(spec)).resolves.toBeDefined()
})

it('enforces the frozen-version spec floor and leaves spec-less content alone', async () => {
  const insert = (content: unknown) => state.pg!.query('insert into work_item_versions(id, content) values (gen_random_uuid(), $1::jsonb)', [JSON.stringify(content)])
  await expect(insert({ schemaVersion: 1, title: 'x' })).resolves.toBeDefined()
  await expect(insert({ schemaVersion: 1, editSpec: spec })).resolves.toBeDefined()
  await expect(insert({ schemaVersion: 1, editSpec: { ...spec, targetUrl: 'javascript:alert(1)' } })).rejects.toThrow()
  await expect(insert({ schemaVersion: 1, editSpec: 'yes' })).rejects.toThrow()
  await expect(insert({ schemaVersion: 1, editSpec: null })).rejects.toThrow()
})
