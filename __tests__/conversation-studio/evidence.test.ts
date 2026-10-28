import { beforeEach, expect, it, vi } from 'vitest'
import { loadStudioEvidence } from '@/lib/conversation-studio/evidence'

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), detail: vi.fn(), sql: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/observations/store', () => ({ loadObservationSnapshot: mocks.snapshot, loadObservationDetail: mocks.detail }))
vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.snapshot.mockResolvedValue({ selectedWeek: '2026-10-26', counts: { recordedRows: 20 }, nextCursor: 'more', items: [{ id: 'observation-id' }] })
  mocks.detail.mockResolvedValue({ id: 'observation-id', question: 'question', result: 'success', rawAnswer: '🦄'.repeat(1000),
    links: [{ url: 'javascript:alert(1)', kind: 'provider-citation' }, { url: 'https://example.com/source', title: 'Source', kind: 'provider-citation' }],
    providerRequestId: 'private-receipt', brandSnapshot: { name: 'secret snapshot' } })
  mocks.sql.mockResolvedValue([])
})
it('projects bounded excerpts and safe links without raw envelopes or provider receipts', async () => {
  const data = await loadStudioEvidence('account-a', 'brand-a')
  expect(mocks.snapshot).toHaveBeenCalledWith('account-a', 'brand-a', expect.objectContaining({ limit: 8, week: null }))
  expect(mocks.detail).toHaveBeenCalledWith('account-a', 'brand-a', 'observation-id')
  expect(data).toMatchObject({ week: '2026-10-26', totalRecorded: 20, truncated: true, scan: null })
  expect(Array.from(data!.observations[0].excerpt!)).toHaveLength(901)
  expect(data!.observations[0].links).toEqual([{ url: 'https://example.com/source', title: 'Source', kind: 'provider-citation' }])
  expect(JSON.stringify(data)).not.toMatch(/private-receipt|secret snapshot|rawAnswer|providerRequestId/)
  const [strings, ...values] = mocks.sql.mock.calls[0]
  expect(strings.join('?')).toMatch(/s.account_id = \? and c.account_id = \?/)
  expect(values).toEqual(['brand-a', 'account-a', 'account-a'])
})
it('stops when the brand is foreign or disappears', async () => {
  mocks.snapshot.mockResolvedValue(null)
  expect(await loadStudioEvidence('other', 'brand-a')).toBeNull()
  expect(mocks.detail).not.toHaveBeenCalled()
  expect(mocks.sql).not.toHaveBeenCalled()
})
it('propagates DB failures instead of claiming there is no evidence', async () => {
  mocks.sql.mockRejectedValue(new Error('private-db-error'))
  await expect(loadStudioEvidence('account-a', 'brand-a')).rejects.toThrow('private-db-error')
})
it('handles deleted observations and invalid legacy scan evidence honestly', async () => {
  mocks.detail.mockResolvedValue(null)
  mocks.sql.mockResolvedValue([{ id: 'scan-id', results: { evidence: { fake: 'invalid' } } }])
  expect(await loadStudioEvidence('account-a', 'brand-a')).toMatchObject({ observations: [], scan: null })
})
