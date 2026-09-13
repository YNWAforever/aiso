import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))

import { loadSuggestionSources, toRegisteredPages } from '@/lib/assets/suggestion-inputs'
import { buildMergeSuggestions } from '@/lib/assets/merge-suggestions'

beforeEach(() => { vi.clearAllMocks() })

describe('toRegisteredPages', () => {
  const assets = [
    { id: 'asset-1', url: 'https://example.com/pricing', origin: 'https://example.com', label: 'Pricing' },
    { id: 'asset-2', url: 'https://example.com/about', origin: 'https://example.com', label: 'About' },
  ]

  it('collects each asset\'s own declared prompt ids, and nothing else\'s', () => {
    const declarations = [
      { assetId: 'asset-1', promptId: 'prompt-1', question: 'Q1' },
      { assetId: 'asset-1', promptId: 'prompt-2', question: 'Q2' },
      { assetId: 'asset-2', promptId: 'prompt-3', question: 'Q3' },
    ]

    expect(toRegisteredPages(assets, declarations)).toEqual([
      { id: 'asset-1', origin: 'https://example.com', label: 'Pricing', promptIds: ['prompt-1', 'prompt-2'] },
      { id: 'asset-2', origin: 'https://example.com', label: 'About', promptIds: ['prompt-3'] },
    ])
  })

  it('gives an asset with no declarations an empty array, not a missing field', () => {
    expect(toRegisteredPages(assets, [])).toEqual([
      { id: 'asset-1', origin: 'https://example.com', label: 'Pricing', promptIds: [] },
      { id: 'asset-2', origin: 'https://example.com', label: 'About', promptIds: [] },
    ])
  })
})

describe('loadSuggestionSources', () => {
  it('flattens a scan-check snapshot to the evaluated/final origins buildMergeSuggestions reads', async () => {
    mocks.sql.mockResolvedValue([{
      work_item_id: 'item-1', opportunity_key: 'scan-check-gap.v1:scan-check:s:c9_meta_desc', source_kind: 'scan-check',
      evidence_snapshot: {
        schemaVersion: 1,
        evidence: { kind: 'scan-check', evaluated: { origin: 'https://old.test' }, final: { origin: 'https://example.com' } },
      },
    }])

    const sources = await loadSuggestionSources('account-1', 'client-1')

    expect(sources).toEqual([{
      itemId: 'item-1', opportunityKey: 'scan-check-gap.v1:scan-check:s:c9_meta_desc', sourceKind: 'scan-check',
      snapshot: { evaluated: { origin: 'https://old.test' }, final: { origin: 'https://example.com' } },
      hasDraft: true,
    }])
  })

  it('flattens a pulse-metric snapshot to the promptId buildMergeSuggestions reads', async () => {
    mocks.sql.mockResolvedValue([{
      work_item_id: 'item-2', opportunity_key: 'pulse-brand-absent.v1:pulse-metric:p', source_kind: 'pulse-metric',
      evidence_snapshot: { schemaVersion: 1, evidence: { kind: 'pulse-metric', promptId: 'prompt-1' } },
    }])

    const sources = await loadSuggestionSources('account-1', 'client-1')

    expect(sources).toEqual([{
      itemId: 'item-2', opportunityKey: 'pulse-brand-absent.v1:pulse-metric:p', sourceKind: 'pulse-metric',
      snapshot: { promptId: 'prompt-1' },
      hasDraft: true,
    }])
  })

  it('marks every returned source drafted, since a live row always belongs to an item', async () => {
    mocks.sql.mockResolvedValue([{
      work_item_id: 'item-1', opportunity_key: 'k', source_kind: 'scan-check',
      evidence_snapshot: { schemaVersion: 1, evidence: { kind: 'scan-check', evaluated: { origin: 'https://example.com' }, final: null } },
    }])

    expect((await loadSuggestionSources('account-1', 'client-1'))[0]!.hasDraft).toBe(true)
  })

  it('scopes the read to the account and client in the statement itself', async () => {
    mocks.sql.mockResolvedValue([])

    await loadSuggestionSources('account-1', 'client-1')

    const values = mocks.sql.mock.calls[0]!.slice(1)
    expect(values).toContain('account-1')
    expect(values).toContain('client-1')
  })

  it('excludes withdrawn sources in the statement text', async () => {
    mocks.sql.mockResolvedValue([])

    await loadSuggestionSources('account-1', 'client-1')

    const statement = (mocks.sql.mock.calls[0]![0] as string[]).join('?')
    expect(statement).toContain('withdrawn_at is null')
  })

  it('wires straight into buildMergeSuggestions: the flattened shape actually pairs', async () => {
    // Each piece is unit-tested against its own expected shape elsewhere; this
    // proves the two compose, not just that each matches its own fixture.
    mocks.sql.mockResolvedValue([
      { work_item_id: 'item-1', opportunity_key: 'scan-check-gap.v1:scan-check:s:c9_meta_desc', source_kind: 'scan-check',
        evidence_snapshot: { schemaVersion: 1, evidence: { kind: 'scan-check', evaluated: { origin: 'https://example.com' }, final: null } } },
      { work_item_id: 'item-2', opportunity_key: 'pulse-brand-absent.v1:pulse-metric:p', source_kind: 'pulse-metric',
        evidence_snapshot: { schemaVersion: 1, evidence: { kind: 'pulse-metric', promptId: 'prompt-1' } } },
    ])
    const sources = await loadSuggestionSources('account-1', 'client-1')
    const pages = toRegisteredPages(
      [{ id: 'asset-1', url: 'https://example.com/pricing', origin: 'https://example.com', label: 'Pricing' }],
      [{ assetId: 'asset-1', promptId: 'prompt-1', question: 'Do you offer annual billing?' }],
    )

    const [suggestion] = buildMergeSuggestions({ assets: pages, sources })

    expect(suggestion).toMatchObject({ assetId: 'asset-1', itemIds: ['item-1', 'item-2'] })
  })
})
