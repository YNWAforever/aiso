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
import { parseEditSpec, type JsonLdEditSpec } from '@/lib/site-edit/edit-spec'
const parseJsonLd = (value: unknown) => parseEditSpec(value) as JsonLdEditSpec

const account = '10000000-0000-4000-8000-000000000001'
const client = '20000000-0000-4000-8000-000000000001'
const item = '30000000-0000-4000-8000-000000000001'
const spec = parseJsonLd({
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
  await state.pg.exec(readFileSync('supabase/migrations/093_site_edit_revert_spec_kind.sql', 'utf8'))
  await state.pg.exec(readFileSync('supabase/migrations/095_site_edit_meta_spec_kind.sql', 'utf8'))
  await state.pg.exec(readFileSync('supabase/migrations/096_site_edit_llms_txt_spec_kind.sql', 'utf8'))
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
  // S5 (093): a revert is storable; any other kind still is not.
  await expect(bad({ ...spec, kind: 'jsonld_remove' })).resolves.toBeDefined()
  await expect(bad({ ...spec, kind: 'jsonld_replace' })).rejects.toThrow()
})

it('enforces the frozen-version spec floor and leaves spec-less content alone', async () => {
  const insert = (content: unknown) => state.pg!.query('insert into work_item_versions(id, content) values (gen_random_uuid(), $1::jsonb)', [JSON.stringify(content)])
  await expect(insert({ schemaVersion: 1, title: 'x' })).resolves.toBeDefined()
  await expect(insert({ schemaVersion: 1, editSpec: spec })).resolves.toBeDefined()
  await expect(insert({ schemaVersion: 1, editSpec: { ...spec, targetUrl: 'javascript:alert(1)' } })).rejects.toThrow()
  await expect(insert({ schemaVersion: 1, editSpec: 'yes' })).rejects.toThrow()
  await expect(insert({ schemaVersion: 1, editSpec: null })).rejects.toThrow()
  await expect(insert({ schemaVersion: 1, editSpec: { ...spec, kind: 'jsonld_remove' } })).resolves.toBeDefined()
  await expect(insert({ schemaVersion: 1, editSpec: { ...spec, kind: 'jsonld_replace' } })).rejects.toThrow()
})

it('S5: saves a revert spec through the real draft statement', async () => {
  const { updateOwnedDraft } = await store()
  const revert = { ...spec, kind: 'jsonld_remove' as const }
  expect(await updateOwnedDraft(account, client, item, null, edit(1, { editSpec: revert }))).toMatchObject({ editSpec: revert })
})

it('reads a spec-bearing version back through jsonb (keys reordered) and exports it', async () => {
  const { freezeReview } = await import('@/lib/change-sets/validation')
  const { versionDTO } = await import('@/lib/change-sets/store')
  const { createDeliveryExport } = await import('@/lib/delivery/export')
  const { saved } = await import('../change-sets/fixtures')
  const { approvedVersion } = await import('../delivery/fixtures')
  const faq = parseJsonLd({
    schemaVersion: 1, kind: 'jsonld', targetUrl: 'https://www.example.com/faq', schemaType: 'FAQPage',
    payload: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Sourdough?', acceptedAnswer: { '@type': 'Answer', text: 'Daily.' } }] },
  })
  const frozen = freezeReview({ ...draft(), editSpec: faq })
  const [stored] = (await state.pg!.query<{ content: Record<string, unknown> }>(
    'insert into work_item_versions(id, content) values (gen_random_uuid(), $1::jsonb) returning content', [JSON.stringify(frozen.content)],
  )).rows
  // Precondition: jsonb really did reorder the keys, or this test proves nothing.
  expect(JSON.stringify(stored!.content.editSpec)).not.toBe(JSON.stringify(faq))
  const version = versionDTO({ ...(await saved()), content: stored!.content, content_hash: frozen.contentHash })
  expect(version.editSpec).toEqual(faq)
  expect(version.contentHash).toBe(frozen.contentHash)
  const approved = approvedVersion()
  const exported = createDeliveryExport({ ...approved, ...version, submittedBy: approved.submittedBy, submittedAt: approved.submittedAt, decision: approved.decision }, 'json')
  expect(JSON.parse(exported.body).content.editSpec).toEqual(faq)
})

it('S9 (095): stores a meta spec, in drafts and frozen versions, under its own floor', async () => {
  const draftSpec = (value: unknown) => state.pg!.query('update evidence_work_items set edit_spec = $1::jsonb where id = $2', [JSON.stringify(value), item])
  const versionSpec = (value: unknown) => state.pg!.query('insert into work_item_versions (id, content) values (gen_random_uuid(), $1::jsonb)', [JSON.stringify({ editSpec: value })])
  const meta = { schemaVersion: 1, kind: 'meta', targetUrl: 'https://www.example.com/', title: 'Menu', description: null }
  for (const write of [draftSpec, versionSpec]) {
    await expect(write(meta)).resolves.toBeDefined()
    await expect(write({ ...meta, title: null, description: 'Fresh bread daily.' })).resolves.toBeDefined()
    await expect(write({ ...meta, title: null })).rejects.toThrow() // nothing to change
    await expect(write({ ...meta, title: '' })).rejects.toThrow()
    await expect(write({ ...meta, title: 'Menu <b>' })).rejects.toThrow()
    await expect(write({ ...meta, title: 'x'.repeat(201) })).rejects.toThrow()
    await expect(write({ ...meta, description: 'x'.repeat(501) })).rejects.toThrow()
    await expect(write({ ...meta, title: 7 })).rejects.toThrow()
    const { description: _d, ...missing } = meta
    await expect(write(missing)).rejects.toThrow()
    await expect(write({ ...meta, targetUrl: 'http://www.example.com/' })).rejects.toThrow()
    // A JSON-LD spec still needs its schema type and payload.
    await expect(write({ ...meta, kind: 'jsonld' })).rejects.toThrow()
    await expect(write(spec)).resolves.toBeDefined()
  }
})

it('S10 (096): stores an llms_txt spec under its own floor, with room for newline-heavy files', async () => {
  const draftSpec = (value: unknown) => state.pg!.query('update evidence_work_items set edit_spec = $1::jsonb where id = $2', [JSON.stringify(value), item])
  const versionSpec = (value: unknown) => state.pg!.query('insert into work_item_versions (id, content) values (gen_random_uuid(), $1::jsonb)', [JSON.stringify({ editSpec: value })])
  const llms = { schemaVersion: 1, kind: 'llms_txt', targetUrl: 'https://www.example.com/llms.txt', content: '# Example\n' }
  for (const write of [draftSpec, versionSpec]) {
    await expect(write(llms)).resolves.toBeDefined()
    // 16 KiB of one-character lines escapes to ~32 KiB of JSON: still storable.
    await expect(write({ ...llms, content: 'x\n'.repeat(8 * 1024) })).resolves.toBeDefined()
    await expect(write({ ...llms, content: 'x'.repeat(16 * 1024 + 1) })).rejects.toThrow()
    await expect(write({ ...llms, content: '' })).rejects.toThrow()
    await expect(write({ ...llms, content: null })).rejects.toThrow()
    await expect(write({ ...llms, targetUrl: 'https://www.example.com/docs/llms.txt' })).rejects.toThrow()
    await expect(write({ ...llms, targetUrl: 'https://www.example.com/llms.txt?x=1' })).rejects.toThrow()
    // The other kinds keep their 20 KiB cap and their own clauses.
    await expect(write({ ...spec, payload: { ...spec.payload, filler: 'x'.repeat(21000) } })).rejects.toThrow()
    await expect(write({ ...llms, kind: 'meta' })).rejects.toThrow()
    await expect(write({ schemaVersion: 1, kind: 'meta', targetUrl: 'https://www.example.com/', title: 'Menu', description: null })).resolves.toBeDefined()
    await expect(write(spec)).resolves.toBeDefined()
  }
})
