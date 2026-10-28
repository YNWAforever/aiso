import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ pg: null as PGlite | null, statements: [] as string[], accountId: '10000000-0000-4000-8000-000000000001' }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: async () => ({ account_id: state.accountId, accounts: { override_plan: 'basic' } }) }))
vi.mock('@/lib/db', () => ({ db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
  state.statements.push(text)
  return (await state.pg!.query(text, values)).rows
} }))
import { POST } from '@/app/api/dashboard/clients/[clientId]/studio/answer/route'

const brand = '20000000-0000-4000-8000-000000000001'
const foreign = '20000000-0000-4000-8000-000000000002'
const protectedTables = ['pulse_metrics', 'ai_citation_log', 'pulse_runs', 'pulse_run_items', 'pulse_item_attempts', 'pulse_run_reservations']
beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec('create table clients(id uuid primary key, account_id uuid, brand_name text, status text);')
  await state.pg.query("insert into clients values($1,$2,'Owned Brand','active'),($3,$4,'FOREIGN SECRET','active')", [brand, state.accountId, foreign, '10000000-0000-4000-8000-000000000002'])
  for (const table of protectedTables) await state.pg.exec(`create table ${table}(id int); insert into ${table} values(42);`)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
afterAll(async () => { await state.pg?.close() })

it('executes real owned SQL and mocked provider orchestration without any metrics/citation/ledger writes', async () => {
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO_LIVE', '1')
  vi.stubEnv('STUDIO_LIVE_ANSWERS_PER_WEEK', '5')
  vi.stubEnv('FEATURE_PULSE_GROUNDING', '0')
  vi.stubEnv('OPENROUTER_API_KEY', 'mock-only')
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const outbound = vi.fn(async () => Response.json({ model: 'mock-model', choices: [{ finish_reason: 'stop', message: { content: 'Mocked answer' } }] }))
  vi.stubGlobal('fetch', outbound)
  const send = (clientId: string) => POST(new Request('https://local.example/api/studio', { method: 'POST', body: JSON.stringify({ prompt: 'Question', platforms: ['gemini-flash'], language: 'en' }) }), { params: Promise.resolve({ clientId }) })
  const denied = await send(foreign)
  expect(denied.status).toBe(404)
  expect(outbound).not.toHaveBeenCalled()
  const allowed = await send(brand)
  expect(allowed.status).toBe(200)
  expect(await allowed.json()).toMatchObject({ answers: [{ answer: 'Mocked answer', coverage: 'present' }] })
  expect(outbound).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(outbound.mock.calls)).not.toContain('FOREIGN SECRET')
  expect(state.statements).toHaveLength(2)
  expect(state.statements.every(sql => /^select id, brand_name from clients where id = \$1::uuid and account_id = \$2 and status = 'active'$/.test(sql))).toBe(true)
  for (const table of protectedTables) expect((await state.pg!.query(`select * from ${table}`)).rows).toEqual([{ id: 42 }])
})
