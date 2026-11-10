import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ pg: null as PGlite | null }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    return (await state.pg!.query(text, values)).rows
  },
}))

const accountA = '10000000-0000-4000-8000-000000000001'
const accountB = '10000000-0000-4000-8000-000000000002'
const clientA = '20000000-0000-4000-8000-000000000001'
const clientArchived = '20000000-0000-4000-8000-000000000002'
const profileA = '30000000-0000-4000-8000-000000000001'
const profileA2 = '30000000-0000-4000-8000-000000000002'
const threadA = '40000000-0000-4000-8000-000000000001'
const threadArchived = '40000000-0000-4000-8000-000000000002'
const reply = { status: 'insufficient', template: null, observations: [], scan: null, researchSteps: [], coverage: { pulse: 'missing', citations: 'missing', scan: 'missing', live: 'unsupported' } }

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table accounts(id uuid primary key);
    create table profiles(id uuid primary key, account_id uuid not null, unique (id, account_id));
    create table clients(id uuid primary key, account_id uuid not null, brand_name text not null, status text not null, unique (id, account_id));
  `)
  await state.pg.query('insert into accounts(id) values($1),($2)', [accountA, accountB])
  await state.pg.query('insert into profiles(id, account_id) values($1,$2),($3,$2)', [profileA, accountA, profileA2])
  await state.pg.query(`insert into clients(id, account_id, brand_name, status) values($1,$2,'Brand A','active'),($3,$2,'Old','archived')`, [clientA, accountA, clientArchived])
  await state.pg.exec(readFileSync('supabase/migrations/081_studio_private_threads.sql', 'utf8'))
  await state.pg.exec(readFileSync('supabase/migrations/103_studio_thread_lifecycle.sql', 'utf8'))
  await state.pg.exec(readFileSync('supabase/migrations/104_studio_thread_branch.sql', 'utf8'))
  await state.pg.exec(readFileSync('supabase/migrations/105_studio_turn_receipts.sql', 'utf8'))
  await state.pg.exec(readFileSync('supabase/migrations/085_studio_drive_exports.sql', 'utf8'))
  for (const [thread, client] of [[threadA, clientA], [threadArchived, clientArchived]]) {
    await state.pg.query(
      `insert into studio_threads (id, account_id, client_id, profile_id, title, goal, kind) values ($1,$2,$3,$4,'Thread A','Goal','research')`,
      [thread, accountA, client, profileA],
    )
    await state.pg.query(
      `insert into studio_thread_turns (thread_id, account_id, client_id, profile_id, position, prompt, reply) values ($1,$2,$3,$4,0,'Question?',$5::jsonb)`,
      [thread, accountA, client, profileA, JSON.stringify(reply)],
    )
  }
})

beforeEach(() => { vi.resetModules() })
afterAll(async () => { await state.pg?.close() })

const service = () => import('@/lib/conversation-studio/drive-export')

it('reads only the member? own saved turn on an active brand', async () => {
  // The real loadTurn statement; the run stops at "not connected" before any Google work.
  const { exportTurnToGoogleDoc } = await service()
  const run = (overrides: Partial<{ accountId: string; profileId: string; clientId: string; threadId: string; position: number }>) =>
    exportTurnToGoogleDoc({ accountId: accountA, profileId: profileA, clientId: clientA, threadId: threadA, position: 0, locale: 'en', ...overrides },
      { loadCredential: vi.fn().mockResolvedValue(null) })
  expect((await run({})).body).toEqual({ error: 'DRIVE_NOT_CONNECTED' })
  expect((await run({ profileId: profileA2 })).body).toEqual({ error: 'NOT_FOUND' })
  expect((await run({ accountId: accountB })).body).toEqual({ error: 'NOT_FOUND' })
  expect((await run({ position: 1 })).body).toEqual({ error: 'NOT_FOUND' })
  expect((await run({ clientId: clientArchived, threadId: threadArchived })).body).toEqual({ error: 'NOT_FOUND' })
})

it('records ledger rows through the real insert, with RLS on and outcome rules enforced', async () => {
  const { exportTurnToGoogleDoc } = await service()
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  const { sealToken } = await import('@/lib/integrations/google/vault')
  const sealed = sealToken('r', { accountId: accountA, purpose: `drive:${profileA}` })
  const result = await exportTurnToGoogleDoc(
    { accountId: accountA, profileId: profileA, clientId: clientA, threadId: threadA, position: 0, locale: 'en' },
    { loadCredential: vi.fn().mockResolvedValue({ status: 'active', sealed }), accessToken: vi.fn().mockResolvedValue('a'),
      create: vi.fn().mockResolvedValue({ fileId: 'file-1', webViewLink: null }) },
  )
  expect(result).toEqual({ status: 201, body: { outcome: 'created', link: null } })
  const rows = (await state.pg!.query('select account_id, client_id, profile_id, thread_id, turn_position, outcome, google_file_id from studio_drive_exports')).rows
  expect(rows).toEqual([{ account_id: accountA, client_id: clientA, profile_id: profileA, thread_id: threadA, turn_position: 0, outcome: 'created', google_file_id: 'file-1' }])
  expect((await state.pg!.query(`select relrowsecurity from pg_class where relname = 'studio_drive_exports'`)).rows).toEqual([{ relrowsecurity: true }])

  const bad = (outcome: string, file: string | null) => state.pg!.query(
    `insert into studio_drive_exports (account_id, client_id, profile_id, thread_id, turn_position, outcome, google_file_id) values ($1,$2,$3,$4,0,$5,$6)`,
    [accountA, clientA, profileA, threadA, outcome, file],
  )
  await expect(bad('created', null)).rejects.toThrow()
  await expect(bad('unknown', 'file-2')).rejects.toThrow()
  await expect(bad('done', null)).rejects.toThrow()
  // Composite FK: a profile cannot be paired with a foreign account's brand.
  await expect(state.pg!.query(
    `insert into studio_drive_exports (account_id, client_id, profile_id, thread_id, turn_position, outcome) values ($1,$2,$3,$4,0,'failed')`,
    [accountB, clientA, profileA, threadA],
  )).rejects.toThrow()
})
