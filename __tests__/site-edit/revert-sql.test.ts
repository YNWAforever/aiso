import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/** Site-edit S5: revertHasApprovedSource's SQL on real Postgres (PGlite) jsonb equality. */

const state = vi.hoisted(() => ({ pg: null as PGlite | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? '$' + index : '') + part, '')
    return (await state.pg!.query(text, values)).rows
  },
}))

import { parseEditSpec, type JsonLdEditSpec } from '@/lib/site-edit/edit-spec'
const parseJsonLd = (value: unknown) => parseEditSpec(value) as JsonLdEditSpec
import { revertHasApprovedSource } from '@/lib/site-edit/revert'

const account = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const client = '30000000-0000-4000-8000-000000000001'
const item = '40000000-0000-4000-8000-000000000001'
const item2 = '40000000-0000-4000-8000-000000000002'
const add = parseJsonLd({ schemaVersion: 1, kind: 'jsonld', targetUrl: 'https://www.bakery.hk/', schemaType: 'Organization',
  payload: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Bakery', sameAs: ['https://x.example'] } })
const revert = { ...add, kind: 'jsonld_remove' as const }
const insert = async (id: string, itemId: string, spec: unknown, decision: string | null, accountId = account) => {
  await state.pg!.query('insert into work_item_versions values ($1, $2, $3, $4, $5, $6)', [id, accountId, client, itemId, JSON.stringify({ title: 'x', editSpec: spec }), id.slice(-1).repeat(64)])
  if (decision) await state.pg!.query('insert into work_item_decisions values ($1, $2, $3, $4, $5, $6)', [accountId, client, itemId, id, id.slice(-1).repeat(64), decision])
}

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table work_item_versions(id uuid primary key, account_id uuid, client_id uuid, work_item_id uuid, content jsonb, content_hash text);
    create table work_item_decisions(account_id uuid, client_id uuid, work_item_id uuid, version_id uuid, content_hash text, decision text);
  `)
})
afterAll(async () => { await state.pg?.close() })

describe('revertHasApprovedSource', () => {
  it('needs an APPROVED add of exactly this block on this item in this account', async () => {
    expect(await revertHasApprovedSource(account, client, item, add)).toBe(true) // an add needs no source
    expect(await revertHasApprovedSource(account, client, item, revert)).toBe(false)
    await insert('50000000-0000-4000-8000-000000000001', item, add, 'changes_requested')
    await insert('50000000-0000-4000-8000-000000000002', item2, add, 'approved')
    await insert('50000000-0000-4000-8000-000000000003', item, add, 'approved', other)
    await insert('50000000-0000-4000-8000-000000000004', item, { ...add, payload: { ...add.payload, name: 'Other' } }, 'approved')
    expect(await revertHasApprovedSource(account, client, item, revert)).toBe(false)
    // Key order inside the stored jsonb is irrelevant.
    const reordered = { payload: { sameAs: ['https://x.example'], name: 'Bakery', '@type': 'Organization', '@context': 'https://schema.org' },
      schemaType: 'Organization', targetUrl: 'https://www.bakery.hk/', kind: 'jsonld', schemaVersion: 1 }
    await insert('50000000-0000-4000-8000-000000000005', item, reordered, 'approved')
    expect(await revertHasApprovedSource(account, client, item, revert)).toBe(true)
    expect(await revertHasApprovedSource(account, client, item, { ...revert, targetUrl: 'https://www.bakery.hk/about' })).toBe(false)
  })
})
