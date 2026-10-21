import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const { sql } = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: () => sql }))
import { parseOpportunityQuery } from '@/lib/opportunities/query'
import { loadOwnedOpportunitySources } from '@/lib/opportunities/store'
import { buildScanEvidence } from '@/lib/scan-evidence'

const account = '00000000-0000-4000-8000-000000000001'
const client = '00000000-0000-4000-8000-000000000002'
const scan = '00000000-0000-4000-8000-000000000003'
beforeEach(() => { sql.mockReset() })
it('accepts one exact scan selection and rejects ambiguous or malformed selections', () => {
  expect(parseOpportunityQuery(new URLSearchParams({ scanId: scan }), account, client))
    .toEqual({ cursor: null, scanId: scan })
  for (const query of [`scanId=${scan}&scanId=${scan}`, 'scanId=invalid', `scanId=${scan}&cursor=abc`]) {
    expect(() => parseOpportunityQuery(new URLSearchParams(query), account, client)).toThrow()
  }
})
it('reads only the requested owned scan and does not load unrelated monitoring data', async () => {
  const envelope = buildScanEvidence({ requestedUrl: 'https://example.test', evaluatedUrl: 'https://example.test',
    industry: 'general_b2b', region: 'HK', sitemapSource: 'unknown',
    checks: { c1_robots: { assessment: 'fail', collection: 'complete' } } })
  sql.mockImplementation((strings: TemplateStringsArray) => {
    const text = strings.join('?')
    if (text.includes('from clients where')) return [{ id: client }]
    if (text.includes('from scans')) return [{ id: scan, client_id: client, account_id: account, created_at: null, envelope }]
    throw new Error('Unrelated query')
  })
  const query = parseOpportunityQuery(new URLSearchParams({ scanId: scan }), account, client)
  const result = await loadOwnedOpportunitySources(account, client, query)
  expect(result?.window.scanId).toBe(scan)
  expect(result?.sources).toHaveLength(1)
  expect(result?.sourceStates).toEqual({ pulse: 'empty', scan: 'ok' })
  const call = sql.mock.calls.find(([strings]) => strings.join('?').includes('from scans'))!
  expect(call[0].join('?')).toContain('s.id = ')
  expect(call.slice(1)).toContain(scan)
  expect(call[0].join('?')).toContain('s.account_id = ')
  expect(call[0].join('?')).toContain('s.client_id = ')
})
it('never substitutes the latest scan when the selected scan is absent or foreign', async () => {
  sql.mockImplementation((strings: TemplateStringsArray) => strings.join('?').includes('from clients where') ? [{ id: client }] : [])
  const query = parseOpportunityQuery(new URLSearchParams({ scanId: scan }), account, client)
  const result = await loadOwnedOpportunitySources(account, client, query)
  expect(result?.sources).toEqual([])
  expect(result?.sourceStates.scan).toBe('empty')
  expect(sql).toHaveBeenCalledTimes(2)
})
