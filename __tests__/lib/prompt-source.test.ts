import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// The validation under test runs before any query. Reaching the database at all
// would mean an invalid batch was accepted far enough to build one.
vi.mock('@/lib/db', () => ({ db: () => { throw new Error('database must not be reached') } }))

import { applyPromptBatch } from '@/lib/prompts/bulk-store'

const scope = { accountId: '10000000-0000-4000-8000-000000000001', clientId: '30000000-0000-4000-8000-000000000001' }
const batch = {
  intentKey: 'intent-key-0001', expectedVersion: 'a'.repeat(32),
  changes: [{ question: 'What is AcmeCo?', category: 'brand_query', language: 'en', market: 'HK', is_active: true }],
}
const apply = (source: unknown) => applyPromptBatch(scope, { ...batch, source } as never)

describe('prompt batch provenance', () => {
  it.each(['manual', 'profile', 'Demand', 42, ''])('refuses a source the bulk flow cannot vouch for (%j)', async source => {
    await expect(apply(source)).rejects.toThrow('INVALID_PROMPT_BATCH')
  })

  it('accepts the one source the demand flow sets, and reaches the write path', async () => {
    await expect(apply('demand')).rejects.toThrow('database must not be reached')
  })

  it('treats an absent source as unrecorded rather than manual', async () => {
    const { source: _source, ...withoutSource } = { ...batch, source: undefined as unknown }
    await expect(applyPromptBatch(scope, withoutSource)).rejects.toThrow('database must not be reached')
  })
})
