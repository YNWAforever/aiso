import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Studio R3 A2b: saved staff threads, through the real thread routes and
 * migrations 081 ??087 ??088 on real Postgres (PGlite). A staff principal is a
 * platform admin of another account holding a LIVE grant from the brand's
 * account; anything less reads exactly like a missing brand.
 */

const state = vi.hoisted(() => ({
  pg: null as PGlite | null,
  profile: null as null | { id: string; account_id: string; is_admin?: boolean },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: async () => state.profile }))
vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    return (await state.pg!.query(text, values)).rows
  },
}))

import { GET as listThreads, POST as createThread } from '@/app/api/dashboard/clients/[clientId]/studio/threads/route'
import { GET as getThread } from '@/app/api/dashboard/clients/[clientId]/studio/threads/[threadId]/route'
import { PATCH as finalizeTurn, POST as appendTurn } from '@/app/api/dashboard/clients/[clientId]/studio/threads/[threadId]/turns/route'

const client = '10000000-0000-4000-8000-000000000001' // the brand's account
const fimmick = '10000000-0000-4000-8000-000000000002' // staff's own account
const member = '20000000-0000-4000-8000-000000000001'
const admin = '20000000-0000-4000-8000-000000000002'
const otherAdmin = '20000000-0000-4000-8000-000000000003'
const plain = '20000000-0000-4000-8000-000000000004'
const brand = '30000000-0000-4000-8000-000000000001'
const grant = '40000000-0000-4000-8000-000000000001'

const reply = {
  status: 'insufficient', template: null, observations: [], scan: null, researchSteps: [],
  coverage: { pulse: 'missing', citations: 'missing', scan: 'missing', live: 'missing' },
}
const threadBody = { kind: 'research', title: 'Staff look', goal: 'Staff look', week: '2026-10-26', sourceTitle: null }
const turnBody = { prompt: 'What changed?', task: null, reply, attached: null }

const as = (id: string, account: string, isAdmin = false) => { state.profile = { id, account_id: account, is_admin: isAdmin } }
const req = (method = 'GET', body?: unknown) => new Request('https://local.example/x', { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
const list = () => listThreads(req(), { params: Promise.resolve({ clientId: brand }) })
const create = () => createThread(req('POST', threadBody), { params: Promise.resolve({ clientId: brand }) })
const read = (threadId: string) => getThread(req(), { params: Promise.resolve({ clientId: brand, threadId }) })
const append = (threadId: string, body: unknown = turnBody) => appendTurn(req('POST', body), { params: Promise.resolve({ clientId: brand, threadId }) })
const q = async (text: string, values: unknown[] = []) => (await state.pg!.query(text, values)).rows as Record<string, unknown>[]

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table accounts(id uuid primary key);
    create table profiles(id uuid primary key, account_id uuid not null references accounts(id), unique(id, account_id));
    create table clients(id uuid primary key, account_id uuid not null references accounts(id), status text not null default 'active', unique(id, account_id));
  `)
  await q('insert into accounts values ($1), ($2)', [client, fimmick])
  await q('insert into profiles values ($1,$2), ($3,$4), ($5,$4), ($6,$4)', [member, client, admin, fimmick, otherAdmin, plain])
  await q('insert into clients(id, account_id) values ($1, $2)', [brand, client])
  for (const file of ['081_studio_private_threads', '087_studio_staff_grants', '088_studio_staff_threads', '103_studio_thread_lifecycle', '104_studio_thread_branch']) {
    await state.pg.exec(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'))
  }
})

beforeEach(async () => {
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
  await state.pg!.exec('delete from studio_thread_turns; delete from studio_threads; delete from studio_staff_audit; delete from studio_staff_grants')
  await q(`insert into studio_staff_grants (id, account_id, grantee_profile_id, granted_by, expires_at) values ($1, $2, $3, $4, now() + interval '30 days')`, [grant, client, admin, member])
})

afterAll(async () => { await state.pg?.close() })

describe('staff threads (A2b)', () => {
  it('saves a staff thread in the client account under the grant, audited in the same statement', async () => {
    as(admin, fimmick, true)
    const created = await create()
    expect(created.status).toBe(201)
    const { thread } = await created.json() as { thread: { id: string } }
    expect(await q('select account_id, profile_id, staff_grant_id, member_profile_id from studio_threads')).toEqual([
      { account_id: client, profile_id: admin, staff_grant_id: grant, member_profile_id: null },
    ])
    expect(await q('select account_id, client_id, actor_profile_id, action from studio_staff_audit')).toEqual([
      { account_id: client, client_id: brand, actor_profile_id: admin, action: 'thread' },
    ])
    expect((await append(thread.id)).status).toBe(201)
    const opened = await (await read(thread.id)).json() as { turns: unknown[] }
    expect(opened.turns).toHaveLength(1)
    expect(((await (await list()).json()) as { threads: unknown[] }).threads).toHaveLength(1)
  })

  it('keeps staff threads private from the client? members, and members??threads private from staff', async () => {
    as(admin, fimmick, true); await create()
    as(member, client); await create()
    expect(await q('select count(*)::int as n from studio_staff_audit')).toEqual([{ n: 1 }]) // a member save is not a staff event
    const memberView = await (await list()).json() as { threads: unknown[] }
    expect(memberView.threads).toHaveLength(1)
    as(admin, fimmick, true)
    expect(((await (await list()).json()) as { threads: unknown[] }).threads).toHaveLength(1)
  })

  it('refuses attach and LIVE results for a staff principal', async () => {
    as(admin, fimmick, true)
    const { thread } = await (await create()).json() as { thread: { id: string } }
    expect((await append(thread.id, { ...turnBody, attached: { label: 'Doc', versionNumber: 1 } })).status).toBe(400)
    expect((await append(thread.id)).status).toBe(201)
    const finalized = await finalizeTurn(req('PATCH', { position: 0, live: { error: 'x' } }), { params: Promise.resolve({ clientId: brand, threadId: thread.id }) })
    expect(finalized.status).toBe(400)
  })

  it('answers 404 without a live grant: another admin, a non-admin, a revoked or an expired grant', async () => {
    as(admin, fimmick, true)
    const { thread } = await (await create()).json() as { thread: { id: string } }
    as(otherAdmin, fimmick, true)
    expect((await list()).status).toBe(404)
    as(plain, fimmick, false)
    expect((await create()).status).toBe(404)
    as(admin, fimmick, true)
    await q(`update studio_staff_grants set revoked_at = now(), revoked_by = $1`, [member])
    expect((await read(thread.id)).status).toBe(404)
    expect((await append(thread.id)).status).toBe(404)
    // The thread itself is kept (grants are never deleted, 087); access is what ends.
    expect(await q('select count(*)::int as n from studio_threads')).toEqual([{ n: 1 }])
    await q(`insert into studio_staff_grants (account_id, grantee_profile_id, granted_by, granted_at, expires_at) values ($1, $2, $3, now() - interval '91 days', now() - interval '1 day')`, [client, admin, member])
    expect((await list()).status).toBe(404)
  })

  it('binds every row in the schema itself: a staff thread to a grant naming its profile, a member thread to its account', async () => {
    const insert = (profile: string, grantId: string | null) => q(
      `insert into studio_threads (account_id, client_id, profile_id, staff_grant_id, kind, title, goal) values ($1, $2, $3, $4, 'research', 't', 'g')`,
      [client, brand, profile, grantId],
    )
    await expect(insert(otherAdmin, grant)).rejects.toThrow(/studio_threads_staff_grant_fkey/) // grant names someone else
    await expect(insert(admin, null)).rejects.toThrow(/studio_threads_member_profile_fkey/) // not a member, no grant
    await insert(member, null)
    await insert(admin, grant)
  })
})
