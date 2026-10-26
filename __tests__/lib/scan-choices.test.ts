import { beforeEach, expect, it, vi } from 'vitest'
import { buildScanEvidence } from '@/lib/scan-evidence'
vi.mock('server-only', () => ({}))
const sql = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ db: () => sql }))
import { isOwnedWorkspaceScan, loadOwnedScanChoices } from '@/lib/workspace/scan-choices'

function evidence(collection: 'complete' | 'failed' | 'blocked' = 'complete', httpStatus = 200) {
  return buildScanEvidence({ requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com', industry: null, region: null, sitemapSource: 'unknown', checks: {},
    observations: [{ check: 'page', collection, httpStatus, target: { origin: 'https://example.com' } }],
  })
}
beforeEach(() => { sql.mockReset() })
it('loads completed scan choices for exactly the current account and brand, including older history', async () => {
  sql.mockResolvedValue(Array.from({ length: 51 }, (_, i) => ({ id: `scan-${i}`, domain: 'example.com', score: '52.50', grade: 'C', created_at: new Date('2026-10-01T08:00:00Z'), evidence: evidence() })))
  const choices = await loadOwnedScanChoices({ accountId: 'account-a', clientId: 'brand-a' })
  expect(choices).toHaveLength(51)
  expect(choices[50]).toEqual({ id: 'scan-50', domain: 'example.com', score: 52.5, grade: 'C', created_at: '2026-10-01T08:00:00.000Z' })
  const [strings, ...values] = sql.mock.calls[0]
  const query = (strings as TemplateStringsArray).join('?')
  expect(query).toMatch(/account_id = \? and client_id = \?/)
  expect(values).toEqual(['account-a', 'brand-a'])
  expect(query).toMatch(/score is not null/)
  expect(query).toMatch(/results->'evidence' as evidence/)
  expect(query).not.toMatch(/limit 10\b/i)
})
it('excludes failed, blocked and unverifiable collection from completed choices while retaining a verified zero', async () => {
  const row = { domain: 'example.com', score: '0', grade: 'F', created_at: '2026-10-01' }
  sql.mockResolvedValue([
    { ...row, id: 'failed', evidence: evidence('failed', 403) },
    { ...row, id: 'blocked', evidence: evidence('blocked', 429) },
    { ...row, id: 'legacy' },
    { ...row, id: 'malformed', evidence: { schemaVersion: 'unsupported' } },
    { ...row, id: 'verified-zero', evidence: evidence() },
  ])
  expect(await loadOwnedScanChoices({ accountId: 'a', clientId: 'b' })).toEqual([{ ...row, id: 'verified-zero', score: 0 }])
})
it('does not offer scans without a finite completed score', async () => {
  sql.mockResolvedValue([null, 'NaN', 'Infinity'].map(score => ({ id: 'incomplete', domain: 'example.com', score, grade: null, created_at: '2026-10-01', evidence: evidence() })))
  expect(await loadOwnedScanChoices({ accountId: 'a', clientId: 'b' })).toEqual([])
})
it('keeps a query failure distinct from an empty scan history', async () => {
  sql.mockRejectedValue(new Error('unavailable'))
  await expect(loadOwnedScanChoices({ accountId: 'a', clientId: 'b' })).rejects.toThrow('unavailable')
})
it('checks selected scan ownership by account, brand and scan independently of score availability', async () => {
  const scanId = '11111111-1111-4111-8111-111111111111'
  sql.mockResolvedValueOnce([{ id: scanId }]).mockResolvedValueOnce([])
  expect(await isOwnedWorkspaceScan({ accountId: 'a', clientId: 'b', scanId })).toBe(true)
  const [strings, ...values] = sql.mock.calls[0]
  expect((strings as TemplateStringsArray).join('?')).toMatch(/account_id = \? and client_id = \? and id = \?/)
  expect(values).toEqual(['a', 'b', scanId])
  expect(await isOwnedWorkspaceScan({ accountId: 'a', clientId: 'other-brand', scanId })).toBe(false)
})
it('rejects malformed scan ids without constructing a database query', async () => {
  expect(await isOwnedWorkspaceScan({ accountId: 'a', clientId: 'b', scanId: 'not-a-uuid' })).toBe(false)
  expect(sql).not.toHaveBeenCalled()
})
