import { describe, it, expect, vi, beforeEach } from 'vitest'

type Call = { text: string; params: unknown[] }
const calls: Call[] = []
let clientRows: unknown[]
let answerRows: unknown[]
let failOn: RegExp | null

const mockSql = vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => {
  const text = strings.join('?')
  calls.push({ text, params })
  if (failOn && failOn.test(text)) return Promise.reject(new Error('boom'))
  if (/from pulse_metrics/i.test(text)) return Promise.resolve(answerRows)
  if (/from competitors/i.test(text)) return Promise.resolve([{ name: 'HSBC Holdings', aliases: ['HSBC'] }])
  if (/from clients/i.test(text)) return Promise.resolve(clientRows)
  return Promise.resolve([])
})
vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

import { GET } from '@/app/api/dashboard/clients/[clientId]/share-of-voice/route'
import { getProfile } from '@/lib/auth'

const params = { params: Promise.resolve({ clientId: 'client-1' }) }
const get = (query = '') => GET(new Request(`http://localhost/api/dashboard/clients/client-1/share-of-voice${query}`), params)

beforeEach(() => {
  calls.length = 0
  failOn = null
  clientRows = [{ brand_name: 'Fimmick', competitors: [] }]
  answerRows = [{ scan_week: '2026-10-05', platform: 'gpt-4o', prompt_id: 'p1', question: 'Q?', brand_mentioned: true, competitors_mentioned: ['hsbc'] }]
  vi.mocked(getProfile).mockReset()
  vi.mocked(getProfile).mockResolvedValue({ id: 'u1', account_id: 'acc-1', accounts: { plan: 'free' } } as never)
})

describe('GET share-of-voice', () => {
  it('answers 401 and touches nothing when signed out', async () => {
    vi.mocked(getProfile).mockResolvedValue(null as never)
    expect((await get()).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('returns the view as JSON, scoped to the session account in every statement', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.view.subjects.map((s: { label: string }) => s.label)).toEqual(['Fimmick', 'HSBC Holdings'])
    for (const statement of calls) {
      expect(statement.text).toMatch(/account_id/)
      expect(statement.params).toContain('acc-1')
    }
  })

  it('downloads a CSV attachment', async () => {
    const res = await get('?format=csv')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="share-of-voice-client-1.csv"')
    // A UTF-8 byte-order mark, so Excel reads Chinese names as UTF-8. Checked as
    // bytes: Response.text() strips a BOM while decoding.
    const bytes = new Uint8Array(await res.clone().arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const csv = await res.text()
    expect(csv.startsWith('week,platform,subject,type,mentions,answers,share_percent\r\n')).toBe(true)
    expect(csv).toContain('2026-10-05,all,HSBC Holdings,competitor,1,1,100')
  })

  it('answers 404 for a client the account does not own', async () => {
    clientRows = []
    expect((await get()).status).toBe(404)
    expect((await get('?format=csv')).status).toBe(404)
  })

  it('answers 503, not 404, when a lookup fails', async () => {
    failOn = /from pulse_metrics/
    expect((await get()).status).toBe(503)
  })

  it('refuses an unknown format', async () => {
    expect((await get('?format=xlsx')).status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})
