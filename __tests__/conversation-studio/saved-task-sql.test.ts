import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ pg: null as PGlite | null, fail: false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (state.fail) throw new Error('PRIVATE_DATABASE_ERROR')
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    return (await state.pg!.query(text, values)).rows
  },
}))
import { loadSavedTaskThread } from '@/lib/conversation-studio/saved-task'

const account = '10000000-0000-4000-8000-000000000001'
const otherAccount = '10000000-0000-4000-8000-000000000002'
const client = '20000000-0000-4000-8000-000000000001'
const otherClient = '20000000-0000-4000-8000-000000000002'
const emptyClient = '20000000-0000-4000-8000-000000000004'
const foreignClient = '20000000-0000-4000-8000-000000000003'
const me = '30000000-0000-4000-8000-000000000001'
const teammate = '30000000-0000-4000-8000-000000000002'

const own = '40000000-0000-4000-8000-000000000001'
const shared = '40000000-0000-4000-8000-000000000002'
const privateOther = '40000000-0000-4000-8000-000000000003'
const archived = '40000000-0000-4000-8000-000000000004'
const improve = '40000000-0000-4000-8000-000000000005'
const legacy = '40000000-0000-4000-8000-000000000006'
const foreign = '40000000-0000-4000-8000-000000000007'

function turn(threadId: string, profileId: string, position: number, task: string, brand = client, reply: unknown = {}) {
  return state.pg!.query(
    'insert into studio_thread_turns(id,thread_id,account_id,client_id,profile_id,position,task,reply) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7::jsonb)',
    [threadId, brand === foreignClient ? otherAccount : account, brand, profileId, position, task, JSON.stringify(reply)],
  )
}

function thread(id: string, profileId: string, input: {
  title: string
  skill: string | null
  updatedAt: string
  visibility?: 'private' | 'shared'
  archived?: boolean
  brand?: string
}) {
  return state.pg!.query(
    `insert into studio_threads(id,account_id,client_id,profile_id,title,skill,visibility,archived_at,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, input.brand === foreignClient ? otherAccount : account, input.brand ?? client, profileId, input.title, input.skill,
      input.visibility ?? 'private', input.archived ? '2026-11-18T00:00:00Z' : null, input.updatedAt],
  )
}

beforeAll(async () => {
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
  vi.stubEnv('STUDIO_ROLLOUT_CLIENT_IDS', '')
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table studio_threads(id uuid primary key, account_id uuid, client_id uuid, profile_id uuid, title text,
      skill text, visibility text, archived_at timestamptz, updated_at timestamptz);
    create table studio_thread_turns(id uuid primary key, thread_id uuid, account_id uuid, client_id uuid,
      profile_id uuid, position int, task text, reply jsonb);
  `)
  await thread(own, me, { title: 'Own pulse', skill: 'visibility_now', updatedAt: '2026-11-16T00:00:00Z' })
  await thread(shared, teammate, { title: 'Shared pulse', skill: 'visibility_now', updatedAt: '2026-11-18T00:00:00Z', visibility: 'shared' })
  await thread(privateOther, teammate, { title: 'Private teammate', skill: 'visibility_now', updatedAt: '2026-11-19T00:00:00Z' })
  await thread(archived, me, { title: 'Archived pulse', skill: 'visibility_now', updatedAt: '2026-11-20T00:00:00Z', archived: true })
  await thread(improve, me, { title: 'Improve work', skill: 'improve_page', updatedAt: '2026-11-21T00:00:00Z' })
  await thread(legacy, me, { title: 'Legacy pulse', skill: null, updatedAt: '2026-11-10T00:00:00Z', brand: otherClient })
  await thread(foreign, me, { title: 'Foreign pulse', skill: 'visibility_now', updatedAt: '2026-11-21T00:00:00Z', brand: foreignClient })
  await turn(own, me, 1, 'pulse')
  await turn(shared, teammate, 1, 'pulse')
  await turn(shared, teammate, 2, 'pulse', client, { observations: [{ excerpt: '**Shared answer line**' }] })
  await turn(privateOther, teammate, 1, 'pulse')
  await turn(archived, me, 1, 'pulse')
  await turn(improve, me, 1, 'improve')
  await turn(legacy, me, 1, 'pulse', otherClient)
  await turn(foreign, me, 1, 'pulse', foreignClient)
})

beforeEach(() => { state.fail = false })
afterAll(async () => { await state.pg?.close(); vi.unstubAllEnvs() })

it('returns the newest visible saved discussion for the exact task', async () => {
  const read = await loadSavedTaskThread({ accountId: account, profileId: me, clientId: client, task: 'pulse' })
  expect(read).toMatchObject({
    state: 'ready',
    thread: { id: shared, title: 'Shared pulse', turnCount: 2, outcomeExcerpt: 'Shared answer line', skill: 'visibility_now', visibility: 'shared', mine: false },
  })
  if (read.state === 'ready') expect(Date.parse(read.thread.updatedAt)).toBe(Date.parse('2026-11-18T00:00:00Z'))
})

it('does not mix another task, an archived thread or another account', async () => {
  const improveRead = await loadSavedTaskThread({ accountId: account, profileId: me, clientId: client, task: 'improve' })
  expect(improveRead).toMatchObject({ state: 'ready', thread: { id: improve, title: 'Improve work' } })
  const other = await loadSavedTaskThread({ accountId: account, profileId: me, clientId: emptyClient, task: 'pulse' })
  expect(other).toEqual({ state: 'empty' })
  const foreign = await loadSavedTaskThread({ accountId: account, profileId: me, clientId: foreignClient, task: 'pulse' })
  expect(foreign).toEqual({ state: 'empty' })
})

it('keeps a pre-skill thread by its first task and stays empty for an unknown task', async () => {
  const legacyRead = await loadSavedTaskThread({ accountId: account, profileId: me, clientId: otherClient, task: 'pulse' })
  expect(legacyRead).toMatchObject({ state: 'ready', thread: { id: legacy, title: 'Legacy pulse' } })
  expect(await loadSavedTaskThread({ accountId: account, profileId: me, clientId: client, task: 'report' })).toEqual({ state: 'empty' })
})

it('reports a read failure explicitly instead of pretending there is no discussion', async () => {
  state.fail = true
  const read = await loadSavedTaskThread({ accountId: account, profileId: me, clientId: client, task: 'pulse' })
  expect(read).toEqual({ state: 'unavailable' })
})
