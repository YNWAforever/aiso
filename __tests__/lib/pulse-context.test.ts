import { afterEach, expect, it, vi } from 'vitest'
import type { LeasedItem } from '@/lib/pulse/runs/schema'
const request = vi.hoisted(() => vi.fn(async (_input: unknown) => ({ answer: 'Synthetic', actualModel: 'synthetic', requestId: null, promptTokens: null, completionTokens: null, costUsd: null, httpStatus: 200 })))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/openrouter', () => ({ callOpenRouterWithEvidence: request }))
vi.mock('@/lib/pulse/runs/store', () => ({ commitAttempt: vi.fn(async () => 'committed') }))
import { processLeasedItem } from '@/lib/pulse/runs/service'
afterEach(() => { vi.unstubAllEnvs(); request.mockClear() })
const item = { model: 'synthetic', snapshot: { question: '中文問題？', language: 'zh-HK', market: 'HK', contextVersion: '2026-10-03.v1' } } as unknown as LeasedItem
it('uses only frozen confirmed context in new collection requests', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-never-sent')
  await processLeasedItem(item, Date.now() + 45_000)
  expect(request.mock.calls[0][0]).toMatchObject({ messages: [{ role: 'system', content: expect.stringContaining('zh-HK') }, { role: 'user', content: '中文問題？' }] })
  expect(JSON.stringify(request.mock.calls[0][0])).toContain('HK')
})
it('preserves the actual original request contract of an already started legacy run', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-never-sent')
  await processLeasedItem({ ...item, snapshot: { question: 'Original?', language: 'legacy', market: null, category: null } }, Date.now() + 45_000)
  expect(request.mock.calls[0][0]).toMatchObject({ messages: [{ role: 'user', content: 'Original?' }] })
})
