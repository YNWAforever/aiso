import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ pg: null as PGlite | null, statements: [] as string[] }))
const accountId = '10000000-0000-4000-8000-000000000001'
const profileId = '30000000-0000-4000-8000-000000000001'
const clientId = '20000000-0000-4000-8000-000000000001'
const threadId = '40000000-0000-4000-8000-000000000001'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: async () => ({ id: profileId, account_id: accountId, accounts: { override_plan: 'pro' } }) }))
vi.mock('@/lib/db', () => ({ db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
  state.statements.push(text)
  return (await state.pg!.query(text, values)).rows
} }))
import { POST } from '@/app/api/dashboard/clients/[clientId]/studio/answer/route'
import { db } from '@/lib/db'
import { webSearchAllowance } from '@/lib/pulse/grounding'
import { studioWeek } from '@/lib/conversation-studio/live-quota'

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table clients(id uuid primary key, account_id uuid, brand_name text, status text);
    create table studio_live_weekly_usage(account_id uuid, client_id uuid, week_start date, answer_count integer check (answer_count >= 0), primary key (account_id, client_id, week_start));
    create table studio_threads(id uuid primary key, account_id uuid, client_id uuid, profile_id uuid);
    create table studio_thread_turns(id uuid primary key, thread_id uuid, account_id uuid, client_id uuid, profile_id uuid, position integer, prompt text, live jsonb, reply jsonb, receipts jsonb);
    create table pulse_metrics(id uuid, client_id uuid, scan_week date, grounding text, run_item_id uuid);
    create table pulse_runs(id uuid, account_id uuid, scan_week date);
    create table pulse_run_items(id uuid, account_id uuid, run_id uuid);
    create table pulse_item_attempts(id uuid, account_id uuid, item_id uuid, grounding text);
  `)
  await state.pg.query("insert into clients values($1,$2,'FOTOMAX','active')", [clientId, accountId])
  await state.pg.query('insert into studio_threads values($1,$2,$3,$4)', [threadId, accountId, clientId, profileId])
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
afterAll(async () => { await state.pg?.close() })

it('sends a saved exchange as conversation history without requesting supplemental web search', async () => {
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO_LIVE', '1')
  vi.stubEnv('FEATURE_PULSE_GROUNDING', '1')
  vi.stubEnv('OPENROUTER_API_KEY', 'mock-only')
  vi.spyOn(console, 'info').mockImplementation(() => {})
  // Prove search is available: a broken/missing usage schema must not produce a false green.
  expect(await webSearchAllowance(db(), accountId, studioWeek())).toMatchObject({ allowed: true, used: 0 })
  state.statements.length = 0

  const prompts = [
    '連線測試：請記住驗證字串「STUDIO-19c8906c」。只回覆「已記住」，不要新增品牌數據。',
    '剛才我請你記住嘅驗證字串係乜？只回覆嗰個字串。',
  ]
  const answers = ['已記住。', 'STUDIO-19c8906c']
  type Outbound = { messages: { role: string; content: string }[]; plugins?: unknown; web_search_options?: unknown }
  const bodies: Outbound[] = []
  const outbound = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Outbound)
    return Response.json({ model: 'openai/gpt-4o', choices: [{ finish_reason: 'stop', message: { content: answers[bodies.length - 1] } }] })
  })
  vi.stubGlobal('fetch', outbound)
  for (let position = 0; position < 2; position++) {
    await state.pg!.query('insert into studio_thread_turns values($1,$2,$3,$4,$5,$6,$7,null,null,null)', [
      `50000000-0000-4000-8000-00000000000${position + 1}`, threadId, accountId, clientId, profileId, position, prompts[position],
    ])
    const response = await POST(new Request('https://local.example/api/studio', {
      method: 'POST', body: JSON.stringify({ prompt: prompts[position], platforms: ['gpt-4o'], language: 'zh-HK', threadId, position }),
    }), { params: Promise.resolve({ clientId }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ answers: [{ model: 'openai/gpt-4o', answer: answers[position], coverage: 'present' }] })
  }
  expect(outbound).toHaveBeenCalledTimes(2)
  expect(bodies[0].messages).toEqual([
    { role: 'system', content: expect.any(String) }, { role: 'user', content: prompts[0] },
  ])
  expect(bodies[1].messages).toEqual([
    { role: 'system', content: expect.any(String) },
    { role: 'user', content: prompts[0] }, { role: 'assistant', content: answers[0] }, { role: 'user', content: prompts[1] },
  ])
  for (const body of bodies) {
    expect(body.plugins).toBeUndefined()
    expect(body.web_search_options).toBeUndefined()
  }
  expect(state.statements.some(text => text.includes('from pulse_metrics'))).toBe(false)
  const saved = (await state.pg!.query<{ live: { state: string; response: { answers: { answer: string }[] } } }>('select live from studio_thread_turns order by position')).rows
  expect(saved.map(row => row.live.state)).toEqual(['complete', 'complete'])
  expect(saved.map(row => row.live.response.answers[0].answer)).toEqual(answers)
})
