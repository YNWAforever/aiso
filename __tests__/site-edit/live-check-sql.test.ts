import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Site-edit S4: migration 091 and lib/site-edit/live-check-store.ts
 * on real Postgres (PGlite), on top of 043/089/090. Parent tables are minimal shapes of
 * the real ones.
 * versionDTO is stubbed: what is under test is the live-check SQL, not the
 * version mapper.
 */

const state = vi.hoisted(() => ({ pg: null as PGlite | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => {
  // Lazy like the Neon driver: a statement runs when awaited, or inside
  // sql.transaction([...]) in one real BEGIN/COMMIT, so versionLocks'
  // transaction-local set_config settings hold for the claim statement.
  const run = async (text: string, values: unknown[]) => (await state.pg!.query(text, values)).rows
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? '$' + index : '') + part, '')
    return { text, values, then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => run(text, values).then(ok, ko) }
  }
  const transaction = async (queries: Array<{ text: string; values: unknown[] }>) => {
    await state.pg!.query('BEGIN')
    try {
      const out = []
      for (const q of queries) out.push(await run(q.text, q.values))
      await state.pg!.query('COMMIT')
      return out
    } catch (error) { await state.pg!.query('ROLLBACK'); throw error }
  }
  return { db: () => Object.assign(tag, { transaction }) }
})
vi.mock('@/lib/change-sets/store', async () => {
  // The real lock protocol and retry policy; only the version mapper is stubbed.
  const actual = await vi.importActual<typeof import('@/lib/change-sets/store')>('@/lib/change-sets/store')
  return {
    retryWrite: actual.retryWrite, versionLocks: actual.versionLocks,
    versionDTO: (row: Record<string, unknown>) => ({
      id: row.id, contentHash: row.content_hash,
      decision: row.decision_record ? { decision: (row.decision_record as Record<string, unknown>).decision } : null,
    }),
  }
})

import { readHandoff } from '@/lib/site-edit/handoff-store'
import { recordLiveCheck } from '@/lib/site-edit/live-check-store'

const account = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const member = '20000000-0000-4000-8000-000000000001'
const stranger = '20000000-0000-4000-8000-000000000002'
const client = '30000000-0000-4000-8000-000000000001'
const item = '40000000-0000-4000-8000-000000000001'
const v1 = '50000000-0000-4000-8000-000000000001'
const v2 = '50000000-0000-4000-8000-000000000002'
const job = '60000000-0000-4000-8000-000000000001'
const h1 = 'a'.repeat(64)
const h2 = 'b'.repeat(64)
const target = 'https://www.bakery.hk/'
const scope = (actorId = member, accountId = account, versionId = v1) => ({ accountId, clientId: client, itemId: item, versionId, actorId })
const q = async (text: string, values: unknown[] = []) => (await state.pg!.query(text, values)).rows as Record<string, unknown>[]
const check = (outcome: 'found' | 'missing' | 'fetch_failed' = 'found', over: Record<string, unknown> = {}) => ({
  outcome, httpStatus: outcome === 'fetch_failed' ? null : 200, pageSha256: outcome === 'fetch_failed' ? null : 'c'.repeat(64),
  checkedAt: new Date(), targetUrl: target, ...over })
const event = (seq: number, kind: string, status: number | null = null) => q(
  'insert into site_edit_job_events (job_id, account_id, seq, kind, actor_id, executor_status) values ($1, $2, $3, $4, $5, $6)', [job, account, seq, kind, member, status])
const attestations = () => q(`select provenance, site_edit_job_id, destination, kind from work_item_delivery_events order by recorded_at`)

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table accounts(id uuid primary key);
    create table profiles(id uuid primary key, account_id uuid not null references accounts(id), display_name text, deactivated_at timestamptz, unique (id, account_id));
    create table clients(id uuid primary key, account_id uuid not null references accounts(id), brand_name text, domain text, unique (id, account_id));
    create table evidence_work_items(id uuid primary key, account_id uuid not null, client_id uuid not null, source_kind text not null default 'scan-check', unique (account_id, client_id, id));
    create table work_item_versions(id uuid primary key, account_id uuid not null, client_id uuid not null, work_item_id uuid not null,
      version_number int not null, content_hash text not null, unique (account_id, client_id, work_item_id, id, content_hash));
    create table work_item_decisions(id uuid primary key default gen_random_uuid(), account_id uuid, client_id uuid, work_item_id uuid, version_id uuid,
      content_hash text, decision text, decided_at timestamptz default now() - interval '1 hour');
  `)
  for (const file of ['043_delivery_attestations', '089_site_edit_jobs', '090_site_edit_receipts', '091_site_edit_live_checks']) {
    await state.pg.exec(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'))
  }
  await q('insert into accounts values ($1), ($2)', [account, other])
  await q(`insert into profiles values ($1, $2, 'Willy', null), ($3, $4, null, null)`, [member, account, stranger, other])
  await q(`insert into clients values ($1, $2, 'Bakery', 'www.bakery.hk')`, [client, account])
  await q('insert into evidence_work_items (id, account_id, client_id) values ($1, $2, $3)', [item, account, client])
})

beforeEach(async () => {
  await state.pg!.exec(`delete from site_edit_live_checks; delete from work_item_delivery_events; delete from site_edit_receipts;
    delete from site_edit_job_events; delete from site_edit_jobs; delete from work_item_decisions; delete from work_item_versions`)
  await q('insert into work_item_versions values ($1, $2, $3, $4, 1, $5)', [v1, account, client, item, h1])
  await q(`insert into work_item_decisions (account_id, client_id, work_item_id, version_id, content_hash, decision) values ($1, $2, $3, $4, $5, 'approved')`, [account, client, item, v1, h1])
  await q('insert into site_edit_jobs (id, account_id, client_id, work_item_id, version_id, content_hash, created_by) values ($1, $2, $3, $4, $5, $6, $7)', [job, account, client, item, v1, h1, member])
  await event(1, 'claim')
})
afterAll(async () => { await state.pg?.close() })

describe('091 + live-check store', () => {
  it('records nothing for a job that was never handed off, was refused, or was declined', async () => {
    expect(await recordLiveCheck(scope(), h1, check())).toEqual({ kind: 'ineligible' })
    await event(2, 'failed', 503)
    expect(await recordLiveCheck(scope(), h1, check())).toEqual({ kind: 'ineligible' })
    await event(3, 'claim'); await event(4, 'sent', 202)
    await q(`insert into site_edit_receipts (job_id, account_id, status, url, completed_at, body_sha256) values ($1, $2, 'rejected', $3, now(), $4)`, [job, account, target, 'd'.repeat(64)])
    expect(await recordLiveCheck(scope(), h1, check())).toEqual({ kind: 'ineligible' })
    expect(await q('select count(*)::int as n from site_edit_live_checks')).toEqual([{ n: 0 }])
    expect(await attestations()).toEqual([])
  })

  it('records a miss without attesting, then a find as ONE verified attestation bound to the job', async () => {
    await event(2, 'sent', 202)
    expect(await recordLiveCheck(scope(), h1, check('missing'))).toEqual({ kind: 'recorded', outcome: 'missing', attested: false, alreadyAttested: false })
    expect(await recordLiveCheck(scope(), h1, check('fetch_failed'))).toMatchObject({ kind: 'recorded', attested: false })
    expect(await attestations()).toEqual([])
    expect(await recordLiveCheck(scope(), h1, check('found'))).toEqual({ kind: 'recorded', outcome: 'found', attested: true, alreadyAttested: false })
    expect(await attestations()).toEqual([{ provenance: 'verified_live', site_edit_job_id: job, destination: target, kind: 'attest' }])
    // A later find is recorded, but the active attestation is not duplicated.
    expect(await recordLiveCheck(scope(), h1, check('found'))).toEqual({ kind: 'recorded', outcome: 'found', attested: false, alreadyAttested: true })
    expect(await attestations()).toHaveLength(1)
    expect(await q('select outcome, attestation_id is not null as attested from site_edit_live_checks order by recorded_at'))
      .toEqual([{ outcome: 'missing', attested: false }, { outcome: 'fetch_failed', attested: false }, { outcome: 'found', attested: true }, { outcome: 'found', attested: false }])
    const read = await readHandoff(scope())
    expect(read.kind === 'ok' && read.liveCheck).toMatchObject({ outcome: 'found', attested: false })
  })

  it('accepts a completed receipt (or an unknown outcome) as open, and refuses strangers, wrong hashes and a superseded version', async () => {
    await event(2, 'unknown')
    expect((await recordLiveCheck(scope(), h1, check('missing'))).kind).toBe('recorded')
    expect(await recordLiveCheck(scope(stranger), h1, check())).toEqual({ kind: 'denied' })
    expect(await recordLiveCheck(scope(stranger, other), h1, check())).toEqual({ kind: 'not_found' })
    expect(await recordLiveCheck(scope(), h2, check())).toEqual({ kind: 'ineligible' })
    await q(`insert into site_edit_receipts (job_id, account_id, status, url, completed_at, body_sha256) values ($1, $2, 'completed', $3, now(), $4)`, [job, account, target, 'd'.repeat(64)])
    await q('insert into work_item_versions values ($1, $2, $3, $4, 2, $5)', [v2, account, client, item, h2])
    expect(await recordLiveCheck(scope(), h1, check())).toEqual({ kind: 'ineligible' })
    await q('delete from work_item_versions where id = $1', [v2])
    expect(await recordLiveCheck(scope(), h1, check())).toMatchObject({ kind: 'recorded', attested: true })
  })

  it('enforces provenance, job binding and check shapes in the schema itself', async () => {
    const [decision] = await q('select id from work_item_decisions')
    const attest = (provenance: string, jobId: string | null, versionId = v1, hash = h1) => q(`insert into work_item_delivery_events (account_id, client_id, work_item_id,
      version_id, content_hash, approval_decision_id, approval_decision, kind, actor_id, actor, request_id, destination, delivered_at, note, provenance, site_edit_job_id)
      values ($1, $2, $3, $4, $5, $6, 'approved', 'attest', $7, $8, gen_random_uuid(), 'Site', now() - interval '1 minute', 'Done', $9, $10)`,
      [account, client, item, versionId, hash, decision.id, member, JSON.stringify({ profileId: member, displayName: null, role: 'account_member' }), provenance, jobId])
    await expect(attest('verified_live', null)).rejects.toThrow(/provenance_check/)
    await expect(attest('self_reported', job)).rejects.toThrow(/provenance_check/)
    await expect(attest('vendor_said_so', null)).rejects.toThrow(/provenance_check/)
    await attest('self_reported', null) // the manual C9e path is untouched
    const shape = (outcome: string, status: number | null, sha: string | null) => q(`insert into site_edit_live_checks (job_id, account_id, outcome, http_status,
      page_sha256, checked_at, actor_id) values ($1, $2, $3, $4, $5, now(), $6)`, [job, account, outcome, status, sha, member])
    await expect(shape('found', 404, 'c'.repeat(64))).rejects.toThrow(/shape_check/)
    await expect(shape('missing', 200, null)).rejects.toThrow(/shape_check/)
    await expect(shape('maybe', 200, 'c'.repeat(64))).rejects.toThrow(/outcome_check/)
    await expect(q(`insert into site_edit_live_checks (job_id, account_id, outcome, checked_at, actor_id) values ($1, $2, 'fetch_failed', now(), $3)`, [job, other, stranger])).rejects.toThrow(/foreign key/)
  })
})
