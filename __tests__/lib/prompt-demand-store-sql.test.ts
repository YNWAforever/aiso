import { it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({ calls: [] as { text: string; values: unknown[] }[], client: [] as unknown[], rows: [] as unknown[], binding: null as unknown, matches: true }))
vi.mock('@/lib/db', () => ({ db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?'); m.calls.push({ text, values })
  return Promise.resolve(/from clients c/.test(text) ? m.client : m.rows) } }))
vi.mock('@/lib/integrations/search-console/store', () => ({ loadBinding: vi.fn(async () => m.binding) }))
vi.mock('@/lib/integrations/search-console/binding', () => ({ bindingMatchesDomain: vi.fn(() => m.matches) }))

import { readDemandInputs } from '@/lib/prompts/demand-store'

beforeEach(() => {
  m.calls.length = 0; m.matches = true
  m.client = [{ brand_name: 'Acme', domain: 'acme.hk', active_count: 4, questions: ['Q1'] }]
  m.binding = { boundAt: '2026-10-01 00:00:00+00', currentDomain: 'acme.hk' }
  m.rows = [{ query: 'braces', clicks: 3, impressions: 40, position: 7.25, start_date: '2026-10-07', end_date: '2026-11-03' }]
})

it('scopes the brand lookup by the caller\'s account and reads nothing else for a foreign brand', async () => {
  m.client = []
  expect(await readDemandInputs('acc-1', 'c-1')).toEqual({ state: 'not_found' })
  expect(m.calls).toHaveLength(1)
  expect(m.calls[0].text).toMatch(/c\.account_id = \?::uuid/)
  expect(m.calls[0].values).toEqual(['c-1', 'acc-1'])
})

it('reads as not connected with no binding, or one that no longer covers the domain', async () => {
  m.binding = null
  expect((await readDemandInputs('acc-1', 'c-1')).state).toBe('not_connected')
  m.binding = { boundAt: 'x', currentDomain: 'other.hk' }; m.matches = false
  expect(await readDemandInputs('acc-1', 'c-1')).toEqual({ state: 'not_connected', brandName: 'Acme', domain: 'acme.hk', activeCount: 4, questions: ['Q1'] })
  expect(m.calls.some(c => /search_console_page_queries/.test(c.text))).toBe(false)
})

it('reads only rows synced under the current binding, for this account and brand, in a 28-day window', async () => {
  const out = await readDemandInputs('acc-1', 'c-1')
  const q = m.calls.find(c => /search_console_page_queries/.test(c.text))!
  expect(q.text).toMatch(/q\.account_id = \?::uuid and q\.client_id = \?::uuid/)
  expect(q.text).toMatch(/q\.synced_at >= \?::timestamptz/)
  expect(q.text).toMatch(/b\.bound_at = \?::timestamptz/)
  expect(q.values.slice(0, 4)).toEqual(['acc-1', 'c-1', '2026-10-01 00:00:00+00', '2026-10-01 00:00:00+00'])
  expect(q.values).toContain(28)
  expect(q.values).toContain(50)
  expect(out).toEqual({ state: 'ok', brandName: 'Acme', domain: 'acme.hk', activeCount: 4, questions: ['Q1'],
    queries: [{ query: 'braces', clicks: 3, impressions: 40, position: 7.25 }], window: { start: '2026-10-07', end: '2026-11-03' } })
})

it('has no window when nothing has synced yet', async () => {
  m.rows = []
  expect(await readDemandInputs('acc-1', 'c-1')).toMatchObject({ state: 'ok', queries: [], window: null })
})
