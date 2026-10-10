import { describe, it, expect, vi, beforeEach } from 'vitest'

type Call = { text: string; params: unknown[] }
const calls: Call[] = []
let clientRows: unknown[]
let failOn: RegExp | null

const mockSql = vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => {
  const text = strings.join('?')
  calls.push({ text, params })
  if (failOn && failOn.test(text)) return Promise.reject(new Error('boom'))
  if (/from pulse_metrics/i.test(text)) return Promise.resolve([
    { scan_week: '2026-10-05', platform: 'gpt-4o', prompt_id: 'p1', question: 'Q?',
      provider_citations: [{ url: 'https://www.hsbc.com.hk/rates', title: 'Rates' }, { url: 'https://acme.com/x', title: null }] },
  ])
  if (/from client_domain_verifications/i.test(text)) return Promise.resolve([{ domain: 'acme.com' }])
  if (/from competitors/i.test(text)) return Promise.resolve([{ name: 'HSBC Holdings', domains: ['hsbc.com.hk'] }])
  if (/from clients/i.test(text)) return Promise.resolve(clientRows)
  return Promise.resolve([])
})
vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

import { GET } from '@/app/api/dashboard/clients/[clientId]/citations/route'
import { getProfile } from '@/lib/auth'

const params = { params: Promise.resolve({ clientId: 'client-1' }) }
const get = (query = '') => GET(new Request(`http://localhost/api/dashboard/clients/client-1/citations${query}`), params)

beforeEach(() => {
  calls.length = 0
  failOn = null
  clientRows = [{ domain: 'https://www.acme.com/' }]
  vi.mocked(getProfile).mockReset()
  vi.mocked(getProfile).mockResolvedValue({ id: 'u1', account_id: 'acc-1', accounts: { plan: 'free' } } as never)
})

describe('GET citations', () => {
  it('answers 401 and touches nothing when signed out', async () => {
    vi.mocked(getProfile).mockResolvedValue(null as never)
    expect((await get()).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('classifies cited sites against the brand and its competitors, scoped to the session account', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const { report } = await res.json()
    expect(report.domains.map((d: { domain: string; kind: string }) => [d.domain, d.kind])).toEqual([
      ['acme.com', 'owned'], ['hsbc.com.hk', 'competitor'],
    ])
    for (const statement of calls) {
      expect(statement.text).toMatch(/account_id/)
      expect(statement.params).toContain('acc-1')
    }
  })

  it('downloads the per-site table as CSV', async () => {
    const res = await get('?format=csv')
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="cited-sources-client-1.csv"')
    const bytes = new Uint8Array(await res.clone().arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const csv = await res.text()
    expect(csv).toContain('domain,type,competitor,answers,citations,questions,platforms\r\n')
    expect(csv).toContain('hsbc.com.hk,competitor,HSBC Holdings,1,1,1,gpt-4o')
  })

  it('answers 404 for a client the account does not own', async () => {
    clientRows = []
    expect((await get()).status).toBe(404)
  })

  it('answers 503, not 404, when a lookup fails', async () => {
    failOn = /from pulse_metrics/
    expect((await get()).status).toBe(503)
  })

  it('refuses an unknown format before any work', async () => {
    expect((await get('?format=xml')).status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})
