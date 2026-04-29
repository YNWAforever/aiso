import { describe, it, expect } from 'vitest'
import { scoreLayer5 } from '@/lib/authority/layer5-dynamic'

describe('Layer 5 Dynamic Learning', () => {
  it('returns zero boost when no citations in DB', async () => {
    const r = await scoreLayer5('unknown-xyz-domain.com', 'technology')
    expect(r.dynamicBoost).toBe(0)
    expect(r.zScore).toBe(0)
    expect(r.citationFrequency90d).toBe(0)
  }, 10_000)
})
