import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => sql }))
vi.mock('@/lib/auth', () => ({ getProfile: async () => profile }))
import { submitAuthenticatedVersion, readAuthenticatedVersion } from '@/lib/change-sets/service'
import { updateWorkOperations } from '@/lib/work-items/operations'
import { freezeReview, freezeMultiSourceReview } from '@/lib/change-sets/validation'
import { draft as fixtureDraft } from './fixtures'

const accountId = '11111111-1111-4111-8111-111111111111'
const clientId = '22222222-2222-4222-8222-222222222222'
const itemId = '33333333-3333-4333-8333-333333333333'
const actorId = '44444444-4444-4444-8444-444444444444'
const owner = { id: actorId, account_id: accountId }
const scope = { accountId, clientId, itemId }
let profile: typeof owner | null = owner
let pg: PGlite
let beforeTransaction: (() => Promise<void>) | null = null
type Statement = { text: string; values: unknown[]; then: Promise<unknown[]>['then'] }
const sql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]): Statement => {
  const text = strings.reduce((all, part, index) => all + (index ? `$${index}` : '') + part, '')
  return { text, values, then: (done, fail) => pg.query(text, values).then(result => result.rows).then(done, fail) }
}, {
  transaction: async (statements: Statement[]) => {
    const hook = beforeTransaction
    beforeTransaction = null
    await hook?.()
    return pg.transaction(async tx => {
      const results = []
      for (const statement of statements) results.push((await tx.query(statement.text, statement.values)).rows)
      return results
    })
  },
})
const request = (revision: number) => new Request('https://fixture.invalid/versions', {
  method: 'POST', body: JSON.stringify({ expectedRevision: revision }),
})
async function submit(revision: number) {
  const response = await submitAuthenticatedVersion(clientId, itemId, request(revision))
  return { status: response.status, body: await response.json() }
}
async function read(id: string) {
  const response = await readAuthenticatedVersion(clientId, itemId, id)
  return { status: response.status, body: await response.json() }
}

beforeEach(async () => {
  // Disposable in-memory WASM PostgreSQL; never instantiate a Neon/Auth client.
  profile = owner
  vi.stubEnv('WORK_ITEM_MULTI_SOURCE_V1', '')
  beforeTransaction = null
  pg = new PGlite()
  await pg.exec(`
    create table accounts(id uuid primary key);
    create table clients(id uuid primary key,account_id uuid);
    create table profiles(id uuid primary key,account_id uuid,display_name text,unique(id,account_id));
    create table evidence_work_items(
      id uuid primary key,account_id uuid,client_id uuid,opportunity_key text,
      source_kind text,source_id uuid,rule_version text,check_key text,evidence_fingerprint text,
      evidence_snapshot jsonb,status text,title text,action text,notes text,locale text,revision integer,
      created_by uuid,updated_by uuid,created_at timestamptz default now(),updated_at timestamptz default now(),
      target_url text,owner_id uuid,due_at date,acceptance_criteria text not null default '',operation_status text not null default 'todo');
    create table work_item_groups(account_id uuid,client_id uuid,work_item_id uuid,created_at timestamptz,scope_snapshot jsonb);
  `)
  // Exercise the actual immutable-version constraints and source schema.
  await pg.exec(readFileSync('supabase/migrations/042_change_set_approvals.sql', 'utf8'))
  await pg.exec(readFileSync('supabase/migrations/051_work_item_sources.sql', 'utf8'))
  await pg.query('insert into accounts(id) values($1)', [accountId])
  await pg.query('insert into clients(id,account_id) values($1,$2)', [clientId, accountId])
  await pg.query('insert into profiles(id,account_id,display_name) values($1,$2,$3)', [actorId, accountId, 'Synthetic submitter'])
  await pg.query('insert into accounts(id) values($1)', ['99999999-9999-4999-8999-999999999999'])
  await pg.query('insert into profiles(id,account_id,display_name) values($1,$2,$3)',
    ['88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999', 'Synthetic foreign member'])
  const item = fixtureDraft()
  await pg.query(`insert into evidence_work_items(id,account_id,client_id,opportunity_key,source_kind,source_id,rule_version,
    evidence_fingerprint,evidence_snapshot,status,title,action,notes,locale,revision,target_url,acceptance_criteria)
    values($1,$2,$3,'fixture','pulse-metric',$10,'pulse-brand-absent.v1',$4,$5::jsonb,'draft',$6,$7,'','en',1,$8,$9)`,
  [itemId, accountId, clientId, 'a'.repeat(64), JSON.stringify(item.evidenceSnapshot), item.title, item.action,
    'https://example.test/original', 'Synthetic original acceptance', item.evidenceSnapshot.source.id])
  await pg.query(`insert into work_item_sources(account_id,client_id,work_item_id,opportunity_key,source_kind,source_id,
    rule_version,evidence_fingerprint,evidence_snapshot,attached_by)
    values($1,$2,$3,'fixture','pulse-metric',$7,'pulse-brand-absent.v1',$4,$5::jsonb,$6)`,
  [accountId, clientId, itemId, 'a'.repeat(64), JSON.stringify(item.evidenceSnapshot), actorId, item.evidenceSnapshot.source.id])
})
afterEach(async () => { try { await pg?.close() } finally { vi.unstubAllEnvs() } })

it.each(['en', 'zh-HK'])('persists immutable preparation, replays once and reads the same owner version after later work edits in %s', async locale => {
  await pg.query('update evidence_work_items set locale=$1 where id=$2', [locale, itemId])
  const first = await submit(1)
  expect(first.status).toBe(201)
  expect(first.body.version).toHaveProperty('preparation', {
    schemaVersion: 1, targetUrl: 'https://example.test/original', acceptanceCriteria: 'Synthetic original acceptance',
  })
  const retained = structuredClone(first.body.version)
  await updateWorkOperations(scope, {
    targetUrl: 'https://example.test/changed-later', acceptanceCriteria: 'Synthetic later acceptance',
    ownerId: null, dueAt: null, operationStatus: 'todo', expectedRevision: 1,
  })
  expect(await read(retained.id)).toEqual({ status: 200, body: { version: retained } })
  const replay = await submit(1)
  expect(replay).toEqual({ status: 200, body: { version: retained } })
  const second = await submit(2)
  expect(second.status).toBe(201)
  expect(second.body.version).toHaveProperty('preparation.targetUrl', 'https://example.test/changed-later')
  expect(second.body.version.contentHash).not.toBe(retained.contentHash)
  expect(await read(retained.id)).toEqual({ status: 200, body: { version: retained } })
  const rows = await pg.query<{ count: number }>('select count(*)::int as count from work_item_versions')
  expect(rows.rows[0].count).toBe(2)
  profile = null
  expect(await read(retained.id)).toEqual({ status: 401, body: { error: 'UNAUTHENTICATED' } })
  profile = { id: '88888888-8888-4888-8888-888888888888', account_id: '99999999-9999-4999-8999-999999999999' }
  expect(await read(retained.id)).toEqual({ status: 404, body: { error: 'CHANGE_SET_NOT_FOUND' } })
})

it('refuses a same-revision metadata change between pre-read and the locked insert', async () => {
  beforeTransaction = async () => {
    await pg.query('update evidence_work_items set target_url=$1,acceptance_criteria=$2 where id=$3',
      ['https://example.test/interleaved', 'Interleaved criteria', itemId])
  }
  expect(await submit(1)).toEqual({ status: 409, body: { error: 'CHANGE_SET_CONFLICT' } })
  expect((await pg.query('select id from work_item_versions')).rows).toEqual([])
})

it('retains preparation with all multi-source evidence and reads it after the feature flag changes', async () => {
  vi.stubEnv('WORK_ITEM_MULTI_SOURCE_V1', '1')
  const snapshot = structuredClone(fixtureDraft().evidenceSnapshot)
  const sourceId = '77777777-7777-4777-8777-777777777777'
  snapshot.source.id = sourceId
  if (snapshot.evidence.kind === 'pulse-metric') snapshot.evidence.id = sourceId
  await pg.query(`insert into work_item_sources(account_id,client_id,work_item_id,opportunity_key,source_kind,source_id,
    rule_version,evidence_fingerprint,evidence_snapshot,attached_by)
    values($1,$2,$3,'fixture-two','pulse-metric',$4,'pulse-brand-absent.v1',$5,$6::jsonb,$7)`,
  [accountId, clientId, itemId, sourceId, 'c'.repeat(64), JSON.stringify(snapshot), actorId])
  const first = await submit(1)
  expect(first.status).toBe(201)
  expect(first.body.version.schemaVersion).toBe(2)
  expect(first.body.version.evidenceSnapshots).toHaveLength(2)
  expect(first.body.version).toHaveProperty('preparation.targetUrl', 'https://example.test/original')
  vi.stubEnv('WORK_ITEM_MULTI_SOURCE_V1', '')
  await updateWorkOperations(scope, {
    targetUrl: null, acceptanceCriteria: '', ownerId: null, dueAt: null, operationStatus: 'todo', expectedRevision: 1,
  })
  expect(await read(first.body.version.id)).toEqual({ status: 200, body: first.body })
})

it.each([1, 2])('reads a legacy schema %s version without filling preparation from current work data', async schema => {
  const item = { ...fixtureDraft(), id: itemId }
  const frozen = schema === 1 ? freezeReview(item) : freezeMultiSourceReview(item, [item.evidenceSnapshot])
  const row = await pg.query<{ id: string }>(`insert into work_item_versions(account_id,client_id,work_item_id,version_number,draft_revision,
    content,content_hash,validation,submitter) values($1,$2,$3,1,1,$4::jsonb,$5,$6::jsonb,$7::jsonb) returning id`,
  [accountId, clientId, itemId, JSON.stringify(frozen.content), frozen.contentHash, JSON.stringify(frozen.validation),
    JSON.stringify({ profileId: actorId, displayName: 'Synthetic submitter', role: 'account_member' })])
  await pg.query('update evidence_work_items set target_url=$1,acceptance_criteria=$2,revision=2 where id=$3',
    ['https://example.test/current-only', 'Current-only acceptance', itemId])
  const result = await read(row.rows[0].id)
  expect(result.status).toBe(200)
  expect(result.body.version.contentHash).toBe(frozen.contentHash)
  expect(result.body.version).not.toHaveProperty('preparation')
  const replay = await submit(1)
  expect(replay.status).toBe(200)
  expect(replay.body.version).toEqual(result.body.version)
})
