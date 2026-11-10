import { describe, expect, it } from 'vitest'
import { buildStudioReceipts, parseStudioReceipts, STUDIO_RECEIPTS_LIMIT } from '@/lib/conversation-studio/receipts'
import { composeSavedReply } from '@/lib/conversation-studio/reply'
import { savedStudioEvidence, savedStudioScan } from '@/__tests__/helpers/studio-evidence'
import { pendingStudioOpportunities, savedStudioOpportunities } from '@/__tests__/helpers/studio-opportunities'

const evidence = { ...savedStudioEvidence, scan: savedStudioScan }
const reply = composeSavedReply('Which bakery offers sourdough?', 'brief', evidence, savedStudioOpportunities)

function receiptsOf(overrides: Partial<Parameters<typeof buildStudioReceipts>[0]> = {}) {
  return buildStudioReceipts({ evidence, reply, opportunities: null, ...overrides })
}

describe('buildStudioReceipts', () => {
  it('records the week, the selected observations, the scan and the reply itself in a fixed order', () => {
    const receipts = receiptsOf()
    expect(receipts.map(item => item.kind)).toEqual(['pulse-week', 'pulse-observations', 'scan', 'compose'])
    expect(receipts[0]).toMatchObject({ id: '2026-10-26', records: 1, truncated: false })
    expect(receipts[1]).toMatchObject({ id: null, records: 1, truncated: false })
    expect(receipts[2]).toMatchObject({ id: savedStudioScan!.id, records: 1, truncated: false })
    expect(receipts[3]).toMatchObject({ kind: 'compose', id: null, records: 1 })
    for (const receipt of receipts) expect(receipt.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is deterministic for the same records and changes when the selection changes', () => {
    expect(receiptsOf()).toEqual(receiptsOf())
    const other = { ...evidence, totalRecorded: 2 }
    const changed = receiptsOf({ evidence: other })
    expect(changed[0]!.digest).not.toBe(receiptsOf()[0]!.digest)
    // The compose digest binds the stored reply, so a different reply cannot share it.
    const otherReply = composeSavedReply('Which bakery offers sourdough?', 'pulse', evidence, savedStudioOpportunities)
    expect(receiptsOf({ reply: otherReply }).at(-1)!.digest).not.toBe(receiptsOf().at(-1)!.digest)
  })

  it('records opportunities only when they exist, never as an empty success', () => {
    const without = receiptsOf()
    expect(without.some(item => item.kind === 'opportunities')).toBe(false)
    const withPending = receiptsOf({ opportunities: pendingStudioOpportunities })
    expect(withPending.some(item => item.kind === 'opportunities')).toBe(false)
    const withSaved = receiptsOf({ opportunities: savedStudioOpportunities })
    expect(withSaved.map(item => item.kind)).toContain('opportunities')
    expect(withSaved.find(item => item.kind === 'opportunities')).toMatchObject({ id: '2026-10-26', records: savedStudioOpportunities.suggestions.length })
  })

  it('never exceeds the stored receipt limit', () => {
    expect(receiptsOf({ opportunities: savedStudioOpportunities }).length).toBeLessThanOrEqual(STUDIO_RECEIPTS_LIMIT)
    expect(STUDIO_RECEIPTS_LIMIT).toBeGreaterThanOrEqual(5)
  })
})

describe('parseStudioReceipts', () => {
  const valid = receiptsOf({ opportunities: savedStudioOpportunities })

  it('round-trips the exact value the server stored', () => {
    expect(parseStudioReceipts(JSON.parse(JSON.stringify(valid)))).toEqual(valid)
  })

  it('reads malformed or absent values as absent, never as an empty success', () => {
    for (const bad of [null, undefined, {}, [], 'receipts', [{}], [...valid, { kind: 'compose', id: null, records: 0, truncated: false, digest: 'short' }]]) {
      expect(parseStudioReceipts(bad)).toBeNull()
    }
    const extraKey = [{ ...valid[0]!, prompt: 'not part of a receipt' }]
    expect(parseStudioReceipts(extraKey)).toBeNull()
    const badKind = [{ ...valid[0]!, kind: 'provider' }]
    expect(parseStudioReceipts(badKind)).toBeNull()
    const negative = [{ ...valid[0]!, records: -1 }]
    expect(parseStudioReceipts(negative)).toBeNull()
    expect(parseStudioReceipts(Array.from({ length: STUDIO_RECEIPTS_LIMIT + 1 }, () => valid[0]))).toBeNull()
  })
})
