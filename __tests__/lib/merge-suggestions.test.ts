import { describe, expect, it } from 'vitest'
import { buildMergeSuggestions } from '@/lib/assets/merge-suggestions'

const scanItem = {
  itemId: 'item-1', opportunityKey: 'scan-check-gap.v1:scan-check:s:c9_meta_desc',
  sourceKind: 'scan-check' as const,
  snapshot: { evaluated: { origin: 'https://example.com' }, final: null },
  hasDraft: true,
}
const pulseItem = {
  itemId: 'item-2', opportunityKey: 'pulse-brand-absent.v1:pulse-metric:p',
  sourceKind: 'pulse-metric' as const,
  snapshot: { promptId: 'prompt-1' },
  hasDraft: false,
}
const asset = { id: 'asset-1', origin: 'https://example.com', label: 'Pricing', promptIds: ['prompt-1'] }

describe('buildMergeSuggestions', () => {
  it('pairs a site finding and a declared question on the same page', () => {
    const [suggestion] = buildMergeSuggestions({ assets: [asset], sources: [scanItem, pulseItem] })

    expect(suggestion!.assetId).toBe('asset-1')
    expect(suggestion!.itemIds.sort()).toEqual(['item-1', 'item-2'])
  })

  it('prefers final origin over evaluated, because that is where the scan ended up', () => {
    const redirected = { ...scanItem, snapshot: { evaluated: { origin: 'https://old.test' }, final: { origin: 'https://example.com' } } }

    expect(buildMergeSuggestions({ assets: [asset], sources: [redirected, pulseItem] })).toHaveLength(1)
  })

  it('says nothing when the pulse source has no prompt id', () => {
    // promptId is nullable. An item that cannot be traced to a page gets no
    // suggestion, reported as untraceable rather than guessed at.
    const untraceable = { ...pulseItem, snapshot: { promptId: null } }

    expect(buildMergeSuggestions({ assets: [asset], sources: [scanItem, untraceable] })).toEqual([])
  })

  it('marks a pair where both already have drafts as not mergeable', () => {
    // Absorbing an existing item is out of scope. The surface must say so
    // rather than appear to offer it.
    const bothDrafted = { ...pulseItem, hasDraft: true }
    const [suggestion] = buildMergeSuggestions({ assets: [asset], sources: [scanItem, bothDrafted] })

    expect(suggestion!.mergeable).toBe(false)
    expect(suggestion!.reason).toBe('both-already-drafted')
  })

  it('does not pair items across different pages', () => {
    const other = { ...asset, id: 'asset-2', origin: 'https://other.test', promptIds: [] }

    expect(buildMergeSuggestions({ assets: [other], sources: [scanItem, pulseItem] })).toEqual([])
  })
})
