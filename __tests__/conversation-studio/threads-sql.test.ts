import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  pg: null as PGlite | null,
  profile: null as null | { id: string; account_id: string },
  fail: false,
  statements: [] as Array<{ text: string; values: unknown[] }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: async () => state.profile }))
vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (state.fail) throw new Error('DB_UNAVAILABLE')
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    state.statements.push({ text, values })
    return (await state.pg!.query(text, values)).rows
  },
}))

import { GET as listThreads, POST as createThread } from '@/app/api/dashboard/clients/[clientId]/studio/threads/route'
import { GET as getThread } from '@/app/api/dashboard/clients/[clientId]/studio/threads/[threadId]/route'
import { PATCH as finalizeTurn, POST as appendTurn } from '@/app/api/dashboard/clients/[clientId]/studio/threads/[threadId]/turns/route'

const accountA = '10000000-0000-4000-8000-000000000001'
const accountB = '10000000-0000-4000-8000-000000000002'
const profileA = '20000000-0000-4000-8000-000000000001'
const profileA2 = '20000000-0000-4000-8000-000000000002'
const profileB = '20000000-0000-4000-8000-000000000003'
const brandA = '30000000-0000-4000-8000-000000000001'
const brandA2 = '30000000-0000-4000-8000-000000000002'
const brandB = '30000000-0000-4000-8000-000000000003'
const missing = '90000000-0000-4000-8000-000000000001'

const reply = {
  status: 'insufficient',
  template: null,
  observations: [],
  scan: null,
  researchSteps: [],
  coverage: { pulse: 'missing', citations: 'missing', scan: 'missing', live: 'missing' },
}
const threadBody = { kind: 'research', title: 'Synthetic goal', goal: 'Synthetic goal', week: '2026-10-26', sourceTitle: null }
const turnBody = { prompt: 'Synthetic question', task: null, reply, attached: null }

const asA = () => { state.profile = { id: profileA, account_id: accountA } }
const asA2 = () => { state.profile = { id: profileA2, account_id: accountA } }
const asB = () => { state.profile = { id: profileB, account_id: accountB } }

function request(url: string, method = 'GET', body?: unknown) {
  return new Request(`https://local.example${url}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
}

async function create(clientId = brandA) {
  const response = await createThread(request(`/api/studio/${clientId}/threads`, 'POST', threadBody), { params: Promise.resolve({ clientId }) })
  return { response, data: await response.json() as { thread: { id: string } } }
}

async function append(clientId: string, threadId: string, body: unknown = turnBody) {
  return appendTurn(request(`/api/studio/${clientId}/threads/${threadId}/turns`, 'POST', body), { params: Promise.resolve({ clientId, threadId }) })
}

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table accounts(id uuid primary key);
    create table profiles(id uuid primary key, account_id uuid not null references accounts(id), unique(id, account_id));
    create table clients(id uuid primary key, account_id uuid not null references accounts(id), status text not null default 'active', unique(id, account_id));
  `)
  await state.pg.query('insert into accounts(id) values($1),($2)', [accountA, accountB])
  await state.pg.query('insert into profiles(id, account_id) values($1,$2),($3,$2),($4,$5)', [profileA, accountA, profileA2, profileB, accountB])
  await state.pg.query('insert into clients(id, account_id) values($1,$2),($3,$2),($4,$5)', [brandA, accountA, brandA2, brandB, accountB])
  await state.pg.exec(readFileSync('supabase/migrations/081_studio_private_threads.sql', 'utf8'))
  // Member flows must be unchanged once 087/088 add staff principals.
  await state.pg.exec(readFileSync('supabase/migrations/087_studio_staff_grants.sql', 'utf8'))
  await state.pg.exec(readFileSync('supabase/migrations/088_studio_staff_threads.sql', 'utf8'))
})

beforeEach(async () => {
  state.fail = false
  state.statements = []
  asA()
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
  await state.pg!.exec('delete from studio_thread_turns; delete from studio_threads;')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  await state.pg?.close()
})

it('creates and lists only the owning account + brand + creator profile', async () => {
  const { response, data } = await create()
  expect(response.status).toBe(201)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(data.thread).toMatchObject({ title: 'Synthetic goal', kind: 'research', turnCount: 0 })

  const own = await listThreads(request('/api/studio'), { params: Promise.resolve({ clientId: brandA }) })
  expect(own.status).toBe(200)
  expect((await own.json()).threads).toHaveLength(1)

  asA2()
  const otherProfile = await listThreads(request('/api/studio'), { params: Promise.resolve({ clientId: brandA }) })
  expect((await otherProfile.json()).threads).toEqual([])

  asA()
  const otherBrand = await listThreads(request('/api/studio'), { params: Promise.resolve({ clientId: brandA2 }) })
  expect((await otherBrand.json()).threads).toEqual([])

  asB()
  const otherAccount = await listThreads(request('/api/studio'), { params: Promise.resolve({ clientId: brandB }) })
  expect((await otherAccount.json()).threads).toEqual([])
  const foreignRead = await getThread(request('/api/studio'), { params: Promise.resolve({ clientId: brandB, threadId: data.thread.id }) })
  expect(foreignRead.status).toBe(404)
})

it('returns 404 for a thread owned by another profile even inside the same brand', async () => {
  const { data } = await create()
  asA2()
  const response = await getThread(request('/api/studio'), { params: Promise.resolve({ clientId: brandA, threadId: data.thread.id }) })
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'NOT_FOUND' })
  const write = await append(brandA, data.thread.id)
  expect(write.status).toBe(404)
})

it('appends ordered turns and finalizes a non-pending LIVE snapshot', async () => {
  const { data } = await create()
  const first = await append(brandA, data.thread.id)
  expect(first.status).toBe(201)
  expect((await first.json()).turn).toMatchObject({ position: 0, prompt: 'Synthetic question' })
  const second = await append(brandA, data.thread.id, { ...turnBody, prompt: 'Follow-up' })
  expect((await second.json()).turn.position).toBe(1)

  const live = await finalizeTurn(request('/api/studio', 'PATCH', { position: 1, live: { error: 'PROVIDER_UNAVAILABLE' } }), { params: Promise.resolve({ clientId: brandA, threadId: data.thread.id }) })
  expect(live.status).toBe(200)
  expect((await live.json()).turn.live).toEqual({ error: 'PROVIDER_UNAVAILABLE' })

  asA()
  const detail = await getThread(request('/api/studio'), { params: Promise.resolve({ clientId: brandA, threadId: data.thread.id }) })
  expect(detail.status).toBe(200)
  const body = await detail.json()
  expect(body.turns.map((turn: { position: number }) => turn.position)).toEqual([0, 1])
  expect(body.thread.turnCount).toBe(2)
  expect(body.turns[1].live).toEqual({ error: 'PROVIDER_UNAVAILABLE' })

  asA2()
  const foreignFinalize = await finalizeTurn(request('/api/studio', 'PATCH', { position: 1, live: { error: 'X' } }), { params: Promise.resolve({ clientId: brandA, threadId: data.thread.id }) })
  expect(foreignFinalize.status).toBe(404)
})

it('rejects unknown keys, oversize prompts and pending LIVE snapshots', async () => {
  const { data } = await create()
  expect((await append(brandA, data.thread.id, { ...turnBody, extra: true })).status).toBe(400)
  expect((await append(brandA, data.thread.id, { ...turnBody, prompt: 'x'.repeat(1001) })).status).toBe(400)
  expect((await append(brandA, data.thread.id, { ...turnBody, prompt: 'x'.repeat(200_000) })).status).toBe(400)
  const pending = await finalizeTurn(request('/api/studio', 'PATCH', { position: 0, live: { pending: true } }), { params: Promise.resolve({ clientId: brandA, threadId: data.thread.id }) })
  expect(pending.status).toBe(400)
  expect((await createThread(request('/api/studio', 'POST', { ...threadBody, extra: true }), { params: Promise.resolve({ clientId: brandA }) })).status).toBe(400)
})

it('returns an honest 409 when the thread reaches fifty turns', async () => {
  const { data } = await create()
  for (let position = 0; position < 50; position += 1) {
    await state.pg!.query(
      `insert into studio_thread_turns(thread_id,account_id,client_id,profile_id,position,prompt,reply)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [data.thread.id, accountA, brandA, profileA, position, `Question ${position}`, JSON.stringify(reply)],
    )
  }
  const full = await append(brandA, data.thread.id)
  expect(full.status).toBe(409)
  expect(await full.json()).toEqual({ error: 'STUDIO_THREAD_FULL' })
})

it('fails closed with 401, 404, 503 and no-store headers', async () => {
  state.profile = null
  const unauth = await listThreads(request('/api/studio'), { params: Promise.resolve({ clientId: brandA }) })
  expect(unauth.status).toBe(401)
  expect(unauth.headers.get('Cache-Control')).toBe('no-store')

  asA()
  expect((await listThreads(request('/api/studio'), { params: Promise.resolve({ clientId: 'bad-id' }) })).status).toBe(404)
  expect((await getThread(request('/api/studio'), { params: Promise.resolve({ clientId: brandA, threadId: 'bad-id' }) })).status).toBe(404)
  expect((await append(brandA, missing)).status).toBe(404)
  expect((await listThreads(request('/api/studio'), { params: Promise.resolve({ clientId: brandB }) })).status).toBe(404)

  state.fail = true
  const down = await listThreads(request('/api/studio'), { params: Promise.resolve({ clientId: brandA }) })
  expect(down.status).toBe(503)
  expect(await down.json()).toEqual({ error: 'STUDIO_THREADS_UNAVAILABLE' })
  expect(down.headers.get('Cache-Control')).toBe('no-store')
})

it('cascades turns when the owning brand is deleted', async () => {
  const { data } = await create(brandA2)
  await append(brandA2, data.thread.id)
  expect((await state.pg!.query('select count(*)::int as n from studio_thread_turns')).rows).toEqual([{ n: 1 }])
  await state.pg!.query('delete from clients where id=$1', [brandA2])
  expect((await state.pg!.query('select count(*)::int as n from studio_threads')).rows).toEqual([{ n: 0 }])
  expect((await state.pg!.query('select count(*)::int as n from studio_thread_turns')).rows).toEqual([{ n: 0 }])
  await state.pg!.query('insert into clients(id, account_id) values($1,$2)', [brandA2, accountA])
})

it('tags each thread with the skill of its first turn, derived on read through the real statements', async () => {
  asA()
  const plain = (await create()).data.thread.id
  const skilled = (await create()).data.thread.id
  expect((await append(brandA, plain)).status).toBe(201)
  expect((await append(brandA, skilled, { ...turnBody, task: 'competitors' })).status).toBe(201)
  // A later turn with another task does not re-tag the thread.
  expect((await append(brandA, skilled, { ...turnBody, task: 'brief' })).status).toBe(201)
  const listed = await (await listThreads(request(`/api/studio/${brandA}/threads`), { params: Promise.resolve({ clientId: brandA }) })).json() as { threads: Array<{ id: string; skill: string | null }> }
  const skillOf = (id: string) => listed.threads.find(thread => thread.id === id)?.skill
  expect(skillOf(plain)).toBeNull()
  expect(skillOf(skilled)).toBe('competitors')
  const detail = await (await getThread(request(`/api/studio/${brandA}/threads/${skilled}`), { params: Promise.resolve({ clientId: brandA, threadId: skilled }) })).json() as { thread: { skill: string | null } }
  expect(detail.thread.skill).toBe('competitors')
  const fresh = await create()
  expect((fresh.data.thread as { skill?: unknown }).skill).toBeNull()
})
