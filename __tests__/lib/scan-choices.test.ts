import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const sql = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ db: () => sql }))
import { loadOwnedScanChoices } from '@/lib/workspace/scan-choices'

beforeEach(() => { sql.mockReset() })
it('loads completed scan choices for exactly the current account and brand, including older history', async () => {
  sql.mockResolvedValue(Array.from({ length: 51 }, (_, i) => ({ id: `scan-${i}`, domain: 'example.com', score: '52.50', grade: 'C', created_at: new Date('2026-10-01T08:00:00Z') })))
  const choices = await loadOwnedScanChoices({ accountId: 'account-a', clientId: 'brand-a' })
  expect(choices).toHaveLength(51)
  expect(choices[50]).toEqual({ id: 'scan-50', domain: 'example.com', score: 52.5, grade: 'C', created_at: '2026-10-01T08:00:00.000Z' })
  const [strings, ...values] = sql.mock.calls[0]
  const query = (strings as TemplateStringsArray).join('?')
  expect(query).toMatch(/account_id = \? and client_id = \?/)
  expect(values).toEqual(['account-a', 'brand-a'])
  expect(query).toMatch(/score is not null/)
  expect(query).not.toMatch(/limit 10\b/i)
})
it('does not offer scans without a finite completed score', async () => {
  sql.mockResolvedValue([null, 'NaN', 'Infinity'].map(score => ({ id: 'incomplete', domain: 'example.com', score, grade: null, created_at: '2026-10-01' })))
  expect(await loadOwnedScanChoices({ accountId: 'a', clientId: 'b' })).toEqual([])
})
it('keeps a query failure distinct from an empty scan history', async () => {
  sql.mockRejectedValue(new Error('unavailable'))
  await expect(loadOwnedScanChoices({ accountId: 'a', clientId: 'b' })).rejects.toThrow('unavailable')
})
