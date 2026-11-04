import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Site-edit S2: migration 089 and every lib/site-edit/handoff-store.ts
 * statement on real Postgres (PGlite). Parent tables are minimal shapes of
 * the real ones — only the columns and keys 089's FKs and the store read.
 * versionDTO is stubbed: what is under test is the hand-off SQL, not the
 * version mapper (covered in __tests__/change-sets).
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

import { claimHandoff, readHandoff, recordHandoffOutcome } from '@/lib/site-edit/handoff-store'

const account = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const member = '20000000-0000-4000-8000-000000000001'
const stranger = '20000000-0000-4000-8000-000000000002'
const client = '30000000-0000-4000-8000-000000000001'
const item = '40000000-0000-4000-8000-000000000001'
const v1 = '50000000-0000-4000-8000-000000000001'
const v2 = '50000000-0000-4000-8000-000000000002'
const h1 = 'a'.repeat(64)
const h2 = 'b'.repeat(64)
const scope = (versionId = v1, actorId = member, accountId = account) => ({ accountId, clientId: client, itemId: item, versionId, actorId })
const q = async (text: string, values: unknown[] = []) => (await state.pg!.query(text, values)).rows as Record<string, unknown>[]
const fresh = () => new Date(Date.now() - 60_000)
const pin = { clientDomain: 'www.bakery.hk', verifiedDomain: 'bakery.hk' }

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table accounts(id uuid primary key);
    create table profiles(id uuid primary key, account_id uuid not null references accounts(id), deactivated_at timestamptz, unique (id, account_id));
    create table clients(id uuid primary key, account_id uuid not null references accounts(id), brand_name text, domain text, unique (id, account_id));
    create table client_domain_verifications(client_id uuid, account_id uuid, domain text, verified_at timestamptz);
    create table evidence_work_items(id uuid primary key, account_id uuid not null, client_id uuid not null, source_kind text not null default 'scan-check', unique (account_id, client_id, id));
    create table work_item_versions(id uuid primary key, account_id uuid not null, client_id uuid not null, work_item_id uuid not null,
      version_number int not null, content_hash text not null, unique (account_id, client_id, work_item_id, id, content_hash));
    create table work_item_decisions(account_id uuid, client_id uuid, work_item_id uuid, version_id uuid, content_hash text, decision text, decided_at timestamptz default now());
  `)
  await state.pg.exec(readFileSync('supabase/migrations/089_site_edit_jobs.sql', 'utf8'))
  await q('insert into accounts values ($1), ($2)', [account, other])
  await q('insert into profiles values ($1, $2, null), ($3, $4, null)', [member, account, stranger, other])
  await q(`insert into clients values ($1, $2, 'Bakery', 'www.bakery.hk')`, [client, account])
  await q(`insert into client_domain_verifications values ($1, $2, 'bakery.hk', now())`, [client, account])
  await q('insert into evidence_work_items (id, account_id, client_id) values ($1, $2, $3)', [item, account, client])
})

beforeEach(async () => {
  await state.pg!.exec('delete from site_edit_job_events; delete from site_edit_jobs; delete from work_item_decisions; delete from work_item_versions')
  await q('insert into work_item_versions values ($1, $2, $3, $4, 1, $5)', [v1, account, client, item, h1])
  await q(`insert into work_item_decisions (account_id, client_id, work_item_id, version_id, content_hash, decision) values ($1, $2, $3, $4, $5, 'approved')`, [account, client, item, v1, h1])
})
afterAll(async () => { await state.pg?.close() })

describe('089 + handoff store', () => {
  it('reads nothing across accounts: a stranger is denied, and an empty job history reads as none', async () => {
    expect((await readHandoff(scope(v1, stranger))).kind).toBe('denied')
    expect((await readHandoff(scope(v1, stranger, other))).kind).toBe('not_found')
    const read = await readHandoff(scope())
    expect(read).toMatchObject({ kind: 'ok', latestId: v1, clientName: 'Bakery', job: null, events: [] })
  })

  it('claims once, serialises a second send while the first is in flight, and records the outcome after it', async () => {
    const first = await claimHandoff(scope(), h1, fresh(), pin)
    expect(first).toMatchObject({ kind: 'claimed', seq: 1 })
    expect(await claimHandoff(scope(), h1, fresh(), pin)).toEqual({ kind: 'busy' })
    if (first.kind !== 'claimed') throw new Error()
    await recordHandoffOutcome({ accountId: account, jobId: first.jobId, claimSeq: 1, actorId: member, kind: 'failed', status: 503, ref: null })
    // After a failure, a manual re-send is a new claim on the same job.
    const again = await claimHandoff(scope(), h1, fresh(), pin)
    expect(again).toEqual({ kind: 'claimed', jobId: first.jobId, seq: 3 })
    await recordHandoffOutcome({ accountId: account, jobId: first.jobId, claimSeq: 3, actorId: member, kind: 'sent', status: 202, ref: 'R-1' })
    // Nothing is ever sent after `sent`.
    expect(await claimHandoff(scope(), h1, fresh(), pin)).toEqual({ kind: 'busy' })
    const read = await readHandoff(scope())
    if (read.kind !== 'ok') throw new Error()
    expect(read.job).toEqual({ id: first.jobId })
    expect(read.events.map(e => [e.seq, e.kind, e.executorStatus, e.executorRef])).toEqual([[1, 'claim', null, null], [2, 'failed', 503, null], [3, 'claim', null, null], [4, 'sent', 202, 'R-1']])
    expect(await q('select count(*)::int as n from site_edit_jobs')).toEqual([{ n: 1 }])
  })

  it('lets a stale claim (process died mid-call) be re-sent', async () => {
    const first = await claimHandoff(scope(), h1, fresh(), pin)
    if (first.kind !== 'claimed') throw new Error()
    await q(`update site_edit_job_events set created_at = now() - interval '5 minutes'`)
    expect(await claimHandoff(scope(), h1, fresh(), pin)).toEqual({ kind: 'claimed', jobId: first.jobId, seq: 2 })
  })

  it('refuses unapproved, superseded, wrong-hash and removed-member claims, writing nothing', async () => {
    await q('delete from work_item_decisions')
    expect(await claimHandoff(scope(), h1, fresh(), pin)).toEqual({ kind: 'ineligible' })
    await q(`insert into work_item_decisions (account_id, client_id, work_item_id, version_id, content_hash, decision) values ($1, $2, $3, $4, $5, 'approved')`, [account, client, item, v1, h1])
    expect(await claimHandoff(scope(), h2, fresh(), pin)).toEqual({ kind: 'ineligible' })
    await q('insert into work_item_versions values ($1, $2, $3, $4, 2, $5)', [v2, account, client, item, h2])
    expect(await claimHandoff(scope(), h1, fresh(), pin)).toEqual({ kind: 'ineligible' }) // v1 is no longer the latest
    await q('delete from work_item_versions where id = $1', [v2])
    await q('update profiles set deactivated_at = now() where id = $1', [member])
    expect(await claimHandoff(scope(), h1, fresh(), pin)).toEqual({ kind: 'ineligible' })
    await q('update profiles set deactivated_at = null where id = $1', [member])
    expect(await q('select count(*)::int as n from site_edit_jobs')).toEqual([{ n: 0 }])
  })

  it('refuses the claim when the brand was repointed or re-verified after the check (pinned domain)', async () => {
    await q(`update clients set domain = 'www.other.hk' where id = $1`, [client])
    expect(await claimHandoff(scope(), h1, fresh(), pin)).toEqual({ kind: 'ineligible' })
    await q(`update clients set domain = 'www.bakery.hk' where id = $1`, [client])
    expect(await claimHandoff(scope(), h1, fresh(), { ...pin, verifiedDomain: 'other.hk' })).toEqual({ kind: 'ineligible' })
    await q('update client_domain_verifications set verified_at = null')
    expect(await claimHandoff(scope(), h1, fresh(), pin)).toEqual({ kind: 'ineligible' })
    await q('update client_domain_verifications set verified_at = now()')
    expect(await q('select count(*)::int as n from site_edit_jobs')).toEqual([{ n: 0 }])
    expect((await claimHandoff(scope(), h1, fresh(), pin)).kind).toBe('claimed')
  })

  it('refuses an outcome for another account’s job', async () => {
    const first = await claimHandoff(scope(), h1, fresh(), pin)
    if (first.kind !== 'claimed') throw new Error()
    await expect(recordHandoffOutcome({ accountId: other, jobId: first.jobId, claimSeq: 1, actorId: stranger, kind: 'sent', status: 200, ref: null })).rejects.toThrow('HANDOFF_OUTCOME_UNRECORDED')
  })

  it('enforces one job per version, the exact approved hash, and the event shapes in the schema itself', async () => {
    const first = await claimHandoff(scope(), h1, fresh(), pin)
    if (first.kind !== 'claimed') throw new Error()
    await expect(q(`insert into site_edit_jobs (account_id, client_id, work_item_id, version_id, content_hash, created_by) values ($1, $2, $3, $4, $5, $6)`, [account, client, item, v1, h1, member])).rejects.toThrow(/unique/)
    await state.pg!.exec('delete from site_edit_job_events; delete from site_edit_jobs')
    await expect(q(`insert into site_edit_jobs (account_id, client_id, work_item_id, version_id, content_hash, created_by) values ($1, $2, $3, $4, $5, $6)`, [account, client, item, v1, h2, member])).rejects.toThrow(/foreign key/)
    const created = await claimHandoff(scope(), h1, fresh(), pin)
    if (created.kind !== 'claimed') throw new Error()
    const event = (seq: number, kind: string, status: number | null, ref: string | null = null) => q(
      `insert into site_edit_job_events (job_id, account_id, seq, kind, actor_id, executor_status, executor_ref) values ($1, $2, $3, $4, $5, $6, $7)`,
      [created.jobId, account, seq, kind, member, status, ref])
    await expect(event(2, 'sent', 500)).rejects.toThrow(/shape_check/)
    await expect(event(2, 'failed', 200)).rejects.toThrow(/shape_check/)
    await expect(event(2, 'unknown', 504)).rejects.toThrow(/shape_check/)
    await expect(event(2, 'claim', 200)).rejects.toThrow(/shape_check/)
    await expect(event(2, 'done', null)).rejects.toThrow(/kind_check/)
    await expect(event(1, 'unknown', null)).rejects.toThrow(/unique/) // seq 1 is the claim
  })
})
