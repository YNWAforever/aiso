import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Site-edit S3: migration 090 and lib/site-edit/receipt-store.ts on real
 * Postgres (PGlite), on top of 089. Parent tables are minimal shapes.
 */

const state = vi.hoisted(() => ({ pg: null as PGlite | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? '$' + index : '') + part, '')
    return (await state.pg!.query(text, values)).rows
  },
}))

import { loadReceiptJob, recordReceipt } from '@/lib/site-edit/receipt-store'

const account = '10000000-0000-4000-8000-000000000001'
const member = '20000000-0000-4000-8000-000000000001'
const client = '30000000-0000-4000-8000-000000000001'
const item = '40000000-0000-4000-8000-000000000001'
const version = '50000000-0000-4000-8000-000000000001'
const job = '60000000-0000-4000-8000-000000000001'
const hash = 'a'.repeat(64)
const target = 'https://www.bakery.hk/'
const q = async (text: string, values: unknown[] = []) => (await state.pg!.query(text, values)).rows as Record<string, unknown>[]
const receipt = (over: Record<string, unknown> = {}) => ({ jobId: job, accountId: account, status: 'completed' as const, url: target,
  completedAt: '2026-11-04T10:00:00Z', note: null, bodySha256: 'b'.repeat(64), ...over })

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table accounts(id uuid primary key);
    create table profiles(id uuid primary key, account_id uuid not null references accounts(id), unique (id, account_id));
    create table work_item_versions(id uuid primary key, account_id uuid not null, client_id uuid not null, work_item_id uuid not null,
      content jsonb not null, content_hash text not null, unique (account_id, client_id, work_item_id, id, content_hash));
  `)
  for (const file of ['089_site_edit_jobs', '090_site_edit_receipts']) await state.pg.exec(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'))
  await q('insert into accounts values ($1)', [account])
  await q('insert into profiles values ($1, $2)', [member, account])
  await q('insert into work_item_versions values ($1, $2, $3, $4, $5, $6)', [version, account, client, item, JSON.stringify({ editSpec: { targetUrl: target } }), hash])
})

beforeEach(async () => {
  await state.pg!.exec('delete from site_edit_receipts; delete from site_edit_job_events; delete from site_edit_jobs')
  await q('insert into site_edit_jobs (id, account_id, client_id, work_item_id, version_id, content_hash, created_by) values ($1, $2, $3, $4, $5, $6, $7)',
    [job, account, client, item, version, hash, member])
})
afterAll(async () => { await state.pg?.close() })

describe('090 + receipt store', () => {
  it('finds the job by its opaque id with its account, frozen target and newest event', async () => {
    expect(await loadReceiptJob('60000000-0000-4000-8000-000000000009')).toBeNull()
    expect(await loadReceiptJob(job)).toEqual({ jobId: job, accountId: account, targetUrl: target, lastEvent: null, receipt: null })
    await q(`insert into site_edit_job_events (job_id, account_id, seq, kind, actor_id) values ($1, $2, 1, 'claim', $3)`, [job, account, member])
    await q(`insert into site_edit_job_events (job_id, account_id, seq, kind, actor_id, executor_status) values ($1, $2, 2, 'sent', $3, 202)`, [job, account, member])
    expect((await loadReceiptJob(job))?.lastEvent).toBe('sent')
  })

  it('records one receipt per job: identical body replays, a different one conflicts', async () => {
    expect(await recordReceipt(receipt())).toBe('created')
    expect(await recordReceipt(receipt())).toBe('replayed')
    expect(await recordReceipt(receipt({ status: 'rejected', bodySha256: 'c'.repeat(64) }))).toBe('conflict')
    expect(await q('select count(*)::int as n from site_edit_receipts')).toEqual([{ n: 1 }])
    expect((await loadReceiptJob(job))?.receipt).toEqual({ bodySha256: 'b'.repeat(64) })
  })

  it('binds each receipt to its job’s own account, and enforces status and size in the schema', async () => {
    await expect(recordReceipt(receipt({ accountId: '10000000-0000-4000-8000-000000000002' }))).rejects.toThrow(/foreign key/)
    await expect(q(`insert into site_edit_receipts (job_id, account_id, status, url, completed_at, body_sha256) values ($1, $2, 'done', $3, now(), $4)`, [job, account, target, 'b'.repeat(64)])).rejects.toThrow(/status_check/)
    await expect(q(`insert into site_edit_receipts (job_id, account_id, status, url, completed_at, note, body_sha256) values ($1, $2, 'completed', $3, now(), $4, $5)`, [job, account, target, 'x'.repeat(2001), 'b'.repeat(64)])).rejects.toThrow(/shape_check/)
  })
})
