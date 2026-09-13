import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const { sql } = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: () => sql }))
import { loadOwnedOpportunitySources, loadSavedDraftMapping } from '@/lib/opportunities/store'
import { buildScanEvidence } from '@/lib/scan-evidence'
const account = '00000000-0000-4000-8000-000000000001'
const client = '00000000-0000-4000-8000-000000000002'
const id = '00000000-0000-4000-8000-000000000003'
const row = { id, client_id: client, prompt_id: null, question: 'Question?', platform: 'chatgpt', scan_week: '2026-08-31', created_at: '2026-09-01T00:00:00.123456Z', raw_answer: 'SECRET answer', brand_mentioned: false, has_answer: true }
const envelope = buildScanEvidence({ requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com', industry: 'technology', region: 'HK', sitemapSource: 'fetched', checks: { c1_robots: { assessment: 'fail', collection: 'complete' } } })
beforeEach(() => sql.mockReset())
it('denies foreign clients before source reads', async () => {
  sql.mockResolvedValueOnce([])
  expect(await loadOwnedOpportunitySources(account, client)).toBeNull()
  expect(sql).toHaveBeenCalledTimes(1)
})
it('bounds Pulse at 201 with 200 retained, scopes queries and preserves exact private inputs', async () => {
  sql.mockResolvedValueOnce([{ id: client }]).mockResolvedValueOnce(Array.from({length:201}, () => row)).mockResolvedValueOnce([])
  const result = await loadOwnedOpportunitySources(account, client)
  expect(result?.sources).toHaveLength(200)
  expect(result?.window).toMatchObject({ pulseWeek:'2026-08-31', pulseTruncated:true, pulseLimit:200, scanId:null })
  expect(result?.evidenceVersions[0]).toMatchObject({ kind:'pulse-metric', row: { raw_answer:'SECRET answer', created_at:row.created_at } })
  const queries = sql.mock.calls.map(call => call[0].join('?').replace(/\s+/g,' '))
  expect(queries[1]).toContain('limit 201')
  expect(queries[1]).toContain('order by m.created_at desc nulls last, m.id desc')
  expect(queries[1]).toContain('max')
  expect(queries[1]).toContain('c.account_id = ?')
  expect(queries[2]).toContain('s.account_id = ?')
  expect(queries[2]).toContain('s.client_id = ?')
  expect(queries[2]).toContain('limit 1')
  expect(queries.join(' ')).not.toMatch(/agent_recommendations|domain|insert|update|delete/i)
})
it('marks invalid newest scan unavailable without an older fallback', async () => {
  sql.mockResolvedValueOnce([{id:client}]).mockResolvedValueOnce([]).mockResolvedValueOnce([{id, client_id:client, account_id:account, created_at:row.created_at, envelope:{ invalid:true }}])
  const result = await loadOwnedOpportunitySources(account,client)
  expect(result?.sourceStates).toEqual({pulse:'empty',scan:'unavailable'})
  expect(sql).toHaveBeenCalledTimes(3)
})
it('preserves healthy scan evidence when Pulse fails', async () => {
  sql.mockResolvedValueOnce([{id:client}]).mockRejectedValueOnce(new Error('SECRET')).mockResolvedValueOnce([{id,client_id:client,account_id:account,created_at:row.created_at,envelope}])
  const result = await loadOwnedOpportunitySources(account,client)
  expect(result?.sourceStates).toEqual({pulse:'unavailable',scan:'ok'})
  expect(result?.sources).toHaveLength(1)
})
it('scopes saved mapping to account/client and requested keys', async () => {
  sql.mockResolvedValueOnce([{id,opportunity_key:'wanted'}, {id:'foreign',opportunity_key:'other'}])
  expect(await loadSavedDraftMapping(account,client,['wanted'])).toEqual(new Map([['wanted',id]]))
  const query = sql.mock.calls[0][0].join('?')
  expect(query).toContain('s.account_id = ')
  expect(query).toContain('s.client_id = ')
  expect(sql.mock.calls[0].slice(1)).toContainEqual(['wanted'])
})
it('reads the key from work_item_sources, filtering to live rows', async () => {
  // Would silently pass without both: an item that gained a second live source
  // under a NEW key (never written to evidence_work_items.opportunity_key at
  // all) would report that key as unsaved forever, and the caller would offer
  // to draft an opportunity that already has a work item. The behavioural half
  // of this claim -- that a withdrawn source's key genuinely stops counting as
  // saved -- needs a real database and is proven in
  // __tests__/integration/work-item-sources.test.ts; a mocked driver can only
  // confirm the filter is present in the statement, not that Postgres honours it.
  sql.mockResolvedValueOnce([])
  await loadSavedDraftMapping(account,client,['wanted'])
  const query = sql.mock.calls[0][0].join(' ')
  expect(query).toContain('from work_item_sources s')
  expect(query).toContain('s.withdrawn_at is null')
})
