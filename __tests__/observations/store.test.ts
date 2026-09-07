import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadObservationSnapshot } from '@/lib/observations/store'
import { parseObservationQuery } from '@/lib/observations/query'
import { MAX_PROMPTS } from '@/lib/pulse/limits'

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))
vi.mock('server-only', () => ({}))
const ACCOUNT = '10000000-0000-4000-8000-000000000001'
const CLIENT = '20000000-0000-4000-8000-000000000001'
const ID = '30000000-0000-4000-8000-000000000003'
const NEXT_ID = '30000000-0000-4000-8000-000000000002'
const PROMPT = '40000000-0000-4000-8000-000000000001'
const TIME = '2026-09-01T12:30:45.123456Z'
const question = { id: PROMPT, question: 'Current text', category: 'unknown-category', language: 'en', isActive: null }
const item = (overrides = {}) => ({ id: ID, prompt_id: PROMPT, question: 'Historical text', platform: 'chatgpt', scan_week: '2026-08-31', created_at: TIME, has_answer: true, brand_mentioned: false, current_prompt: question, ...overrides })
const snapshot = (overrides = {}) => ({ owned: true, selected_week: '2026-08-31', weeks: ['2026-08-31'], questions: [question], items: [item()], recorded_rows: '3', successful_rows: '1', ...overrides })
const query = (value = '') => parseObservationQuery(new URLSearchParams(value))
function captured() {
  const [strings, ...values] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
  expect(strings.raw).toBeDefined()
  return { text: strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase(), values }
}
beforeEach(() => { sqlMock.mockReset() })

describe('loadObservationSnapshot', () => {
  it('reads one owned snapshot and projects only the public DTO without changing denominators', async () => {
    sqlMock.mockResolvedValue([snapshot({ items: [item({ account_id: ACCOUNT, raw_answer: 'secret', extra: 'private' })] })])
    const result = await loadObservationSnapshot(ACCOUNT, CLIENT, query('result=success'))
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(result?.counts).toEqual({ recordedRows: 3, successfulRows: 1, incompleteRows: 2 })
    expect(result?.items[0]).toMatchObject({ question: 'Historical text', result: 'success', hasAnswer: true, brandMentioned: false, recordedAt: TIME, collectedAt: null, model: null, market: null, currentPrompt: question })
    expect(Object.keys(result!.items[0]).sort()).toEqual(['id', 'sourceKind', 'promptId', 'question', 'platform', 'scanWeek', 'recordedAt', 'collectedAt', 'model', 'market', 'result', 'hasAnswer', 'brandMentioned', 'currentPrompt', 'limitations'].sort())
    expect(JSON.stringify(result)).not.toMatch(/secret|private|account_id|raw_answer/)
  })

  it('joins every source through ownership and keeps result/cursor predicates after counts', async () => {
    sqlMock.mockResolvedValue([snapshot()])
    await loadObservationSnapshot(ACCOUNT, CLIENT, query('promptId=' + PROMPT + '&platform=chatgpt&result=incomplete'))
    const { text, values } = captured()
    expect(text).toMatch(/owned as \( select id, account_id from clients where id = \? and account_id = \? \)/)
    expect(text.match(/from pulse_metrics m join owned c on c.id = m.client_id/g)).toHaveLength(2)
    expect(text).toContain('from prompt_bank p join owned c on c.id = p.client_id')
    expect(text).toContain('left join prompt_bank p on p.id = m.prompt_id and p.client_id = m.client_id and p.client_id = c.id')
    const filtered = text.slice(text.indexOf('filtered as ('), text.indexOf('counts as ('))
    expect(filtered).toContain('m.scan_week = w.week')
    expect(filtered).toContain('m.prompt_id = ?')
    expect(filtered).toContain('m.platform = ?')
    expect(filtered).not.toMatch(/cursor|result|limit/)
    const counts = text.slice(text.indexOf('counts as ('), text.indexOf('page_rows as ('))
    expect(counts).toContain('from filtered')
    expect(counts).not.toMatch(/limit|created_at|success\x27|incomplete\x27/)
    expect(text).toContain("coalesce(m.raw_answer ~ '[^[:space:]]', false) as has_answer")
    expect(text).toContain('m.brand_mentioned is not null as classified')
    expect(text).not.toMatch(/jsonb?_agg\([a-z]+\.\*|row_to_json|to_jsonb|\x27raw_answer\x27/)
    expect(values).toContain(ACCOUNT)
    expect(values).toContain(CLIENT)
    expect(values).toContain(PROMPT)
    expect(values).toContain('incomplete')
    expect(text).not.toContain(ACCOUNT)
  })

  it('bounds independent week and question menus and parameterizes exact filter text', async () => {
    const platform = "x' OR true --"
    sqlMock.mockResolvedValue([snapshot({ questions: Array.from({ length: MAX_PROMPTS + 1 }, () => ({ ...question, account_id: ACCOUNT })) })])
    const result = await loadObservationSnapshot(ACCOUNT, CLIENT, query('limit=100&platform=' + encodeURIComponent(platform)))
    const { text, values } = captured()
    expect(text).toContain('order by m.scan_week desc limit 40')
    expect(text).toContain('coalesce(?::date, max(scan_week))')
    expect(text).toContain('order by p.id limit ?')
    expect(values).toContain(101)
    expect(values).toContain(MAX_PROMPTS + 1)
    expect(values).toContain(platform)
    expect(text).not.toContain(platform.toLowerCase())
    expect(result?.questions).toHaveLength(MAX_PROMPTS)
    expect(result?.questionsTruncated).toBe(true)
    expect(result?.questions[0]).toEqual(question)
  })

  it.each([false, undefined])('returns null for missing/foreign owned client (%s)', async owned => {
    sqlMock.mockResolvedValue(owned === undefined ? [] : [snapshot({ owned })])
    expect(await loadObservationSnapshot(ACCOUNT, CLIENT, query())).toBeNull()
  })

  it('distinguishes an owned empty database from a requested week with no matches', async () => {
    sqlMock.mockResolvedValue([snapshot({ selected_week: null, weeks: [], items: [], questions: [], recorded_rows: 0, successful_rows: 0 })])
    expect(await loadObservationSnapshot(ACCOUNT, CLIENT, query())).toEqual({ schemaVersion: 1, clientId: CLIENT, selectedWeek: null, weeks: [], questions: [], questionsTruncated: false, items: [], counts: { recordedRows: 0, successfulRows: 0, incompleteRows: 0 }, nextCursor: null })
    sqlMock.mockResolvedValue([snapshot({ selected_week: '2026-01-05', items: [], recorded_rows: 0, successful_rows: 0 })])
    expect(await loadObservationSnapshot(ACCOUNT, CLIENT, query('week=2026-01-05'))).toMatchObject({ selectedWeek: '2026-01-05', weeks: ['2026-08-31'], items: [], nextCursor: null })
  })

  it('preserves PostgreSQL microseconds and uses the last delivered row for a continuation', async () => {
    sqlMock.mockResolvedValue([snapshot({ items: [item(), item({ id: NEXT_ID })] })])
    const result = await loadObservationSnapshot(ACCOUNT, CLIENT, query('limit=1'))
    expect(result?.items).toHaveLength(1)
    expect(query('week=2026-08-31&cursor=' + result?.nextCursor).cursor).toEqual({ recordedAt: TIME, id: ID })
    const { text } = captured()
    expect(text).toContain("to_char(r.created_at at time zone 'utc', 'yyyy-mm-dd\"t\"hh24:mi:ss.us\"z\"')")
    expect(text).toContain('order by created_at desc nulls last, id desc limit ?')
    expect(text).toContain('order by r.created_at desc nulls last, r.id desc')
  })

  it('includes null timestamps after a known cursor and breaks repeated timestamp ties by descending id', async () => {
    const cursor = Buffer.from(JSON.stringify({ recordedAt: TIME, id: ID })).toString('base64url')
    sqlMock.mockResolvedValue([snapshot({ items: [item({ id: NEXT_ID }), item({ created_at: null })] })])
    await loadObservationSnapshot(ACCOUNT, CLIENT, query('week=2026-08-31&cursor=' + cursor))
    const { text, values } = captured()
    expect(text).toContain('created_at < ?::timestamptz')
    expect(text).toContain('created_at = ?::timestamptz and id < ?::uuid')
    expect(text).toContain('or created_at is null')
    expect(values).toContain(TIME)
    expect(values).toContain(ID)
  })

  it('continues within null timestamps and has no cursor on a final page', async () => {
    sqlMock.mockResolvedValue([snapshot({ items: [item({ created_at: null }), item({ id: NEXT_ID, created_at: null })] })])
    const result = await loadObservationSnapshot(ACCOUNT, CLIENT, query('limit=1'))
    const next = query('week=2026-08-31&limit=1&cursor=' + result?.nextCursor)
    expect(next.cursor).toEqual({ recordedAt: null, id: ID })
    sqlMock.mockReset().mockResolvedValue([snapshot({ items: [item({ id: NEXT_ID, created_at: null, current_prompt: null, has_answer: false, brand_mentioned: null })] })])
    const last = await loadObservationSnapshot(ACCOUNT, CLIENT, next)
    expect(last?.nextCursor).toBeNull()
    expect(last?.items[0]).toMatchObject({ recordedAt: null, result: 'incomplete', currentPrompt: null, hasAnswer: false })
    expect(captured().text).toContain('created_at is null and id < ?::uuid')
  })

  it('normalizes driver date values without rounding the timestamp key', async () => {
    sqlMock.mockResolvedValue([snapshot({ selected_week: new Date(2026, 7, 31), weeks: [new Date(2026, 7, 31)], items: [item({ scan_week: new Date(2026, 7, 31) })] })])
    expect(await loadObservationSnapshot(ACCOUNT, CLIENT, query())).toMatchObject({ selectedWeek: '2026-08-31', weeks: ['2026-08-31'], items: [{ scanWeek: '2026-08-31', recordedAt: TIME }] })
  })

  it('propagates database failure rather than reporting an empty success', async () => {
    sqlMock.mockRejectedValue(new Error('DB_FAILURE'))
    await expect(loadObservationSnapshot(ACCOUNT, CLIENT, query())).rejects.toThrow('DB_FAILURE')
  })
})
