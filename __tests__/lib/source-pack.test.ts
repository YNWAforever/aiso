import { describe, expect, it } from 'vitest'
import { buildSourcePack, type SourceUsability } from '@/lib/view-models/source-pack'
import { STALE_AFTER_DAYS, type SourceDto } from '@/lib/sources/schema'

/**
 * The screen has to agree with the gate.
 *
 * Three server conditions decide whether a draft may quote a source, and
 * `listAgentUsableSources` requires all three. The failure this guards is a
 * screen that answers a narrower question than the server does — showing an
 * enabled toggle on a source that was never approved, so an owner believes their
 * facts are in play when nothing will ever cite them.
 */

const NOW = new Date('2026-09-10T00:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

function source(over: Partial<SourceDto> = {}, version: Partial<NonNullable<SourceDto['current']>> = {}): SourceDto {
  return {
    id: 'src-1',
    sourceKey: 'brand-facts',
    kind: 'facts',
    label: 'Brand facts',
    agentUseAllowed: true,
    revokedAt: null,
    latestVersion: 2,
    freshness: 'current',
    updatedAt: daysAgo(1),
    current: {
      id: 'ver-1',
      versionNumber: 2,
      contentHash: 'a'.repeat(64),
      importMethod: 'paste',
      originRef: null,
      importedAt: daysAgo(1),
      approvedAt: daysAgo(1),
      entries: [{ question: 'What are your hours?', answer: '9 to 6' }],
      ...version,
    },
    ...over,
  }
}

const usabilityOf = (over: Partial<SourceDto>, version: Partial<NonNullable<SourceDto['current']>> = {}): SourceUsability =>
  buildSourcePack([source(over, version)], NOW).entries[0]!.usability

describe('will a draft actually use this', () => {
  it('is in use only when all three server conditions hold', () => {
    expect(usabilityOf({})).toBe('in-use')
  })

  it.each([
    ['a revoked source', { revokedAt: daysAgo(0) }, {}, 'revoked'],
    ['an unapproved version', {}, { approvedAt: null }, 'awaiting-approval'],
    ['agent use switched off', { agentUseAllowed: false }, {}, 'not-permitted'],
    ['a source with no version at all', { current: null }, {}, 'awaiting-approval'],
  ] as const)('reports %s as %s', (_label, over, version, expected) => {
    expect(usabilityOf(over, version)).toBe(expected)
  })

  it('reports the strongest blocker, not the cheapest to clear', () => {
    // Revocation is terminal. Saying "not permitted" here would name a toggle
    // that changes nothing.
    expect(usabilityOf({ revokedAt: daysAgo(0), agentUseAllowed: false }, { approvedAt: null })).toBe('revoked')
    expect(usabilityOf({ agentUseAllowed: false }, { approvedAt: null })).toBe('awaiting-approval')
  })

  it('shows the toggle state even when the toggle is not what is blocking', () => {
    // The owner has to be able to see that they already switched it on and it
    // still is not being used.
    const entry = buildSourcePack([source({ agentUseAllowed: true }, { approvedAt: null })], NOW).entries[0]!

    expect(entry.agentUseAllowed).toBe(true)
    expect(entry.usability).toBe('awaiting-approval')
  })
})

describe('provenance, which is an import and not a connection', () => {
  it('carries the method, the origin note and the import time', () => {
    const entry = buildSourcePack([source({}, {
      importMethod: 'csv', originRef: 'faq-export-2026-03.csv', importedAt: daysAgo(30),
    })], NOW).entries[0]!

    expect(entry.provenance).toEqual({
      importMethod: 'csv',
      originRef: 'faq-export-2026-03.csv',
      importedAt: daysAgo(30),
      ageDays: 30,
    })
  })

  it('identifies the exact text a draft would quote', () => {
    // The citation a grounded answer carries is (version number, content hash);
    // an owner cannot check what was cited unless the screen shows both.
    const entry = buildSourcePack([source()], NOW).entries[0]!

    expect(entry.versionNumber).toBe(2)
    expect(entry.contentHash).toBe('a'.repeat(64))
    expect(entry.entryCount).toBe(1)
  })

  it('has nothing to say about a source with no imported version', () => {
    const entry = buildSourcePack([source({ current: null })], NOW).entries[0]!

    expect(entry.provenance).toEqual({ importMethod: null, originRef: null, importedAt: null, ageDays: null })
    expect(entry.freshness).toBeNull()
    expect(entry.contentHash).toBeNull()
    expect(entry.entryCount).toBe(0)
  })
})

describe('freshness is an age, and it does not gate anything', () => {
  it('turns stale strictly after the age, not on it', () => {
    expect(buildSourcePack([source({}, { importedAt: daysAgo(STALE_AFTER_DAYS) })], NOW).entries[0]!.freshness)
      .toBe('current')
    expect(buildSourcePack([source({}, { importedAt: daysAgo(STALE_AFTER_DAYS + 1) })], NOW).entries[0]!.freshness)
      .toBe('stale')
  })

  it('keeps a stale source in use, and counts it', () => {
    // The server gate ignores age entirely. Showing stale as though it excluded
    // the source would invert the risk: the text IS still being quoted.
    const pack = buildSourcePack([source({}, { importedAt: daysAgo(400) })], NOW)

    expect(pack.entries[0]!.usability).toBe('in-use')
    expect(pack.inUse).toBe(1)
    expect(pack.staleInUse).toBe(1)
  })

  it('does not count a stale source that is not in use', () => {
    const pack = buildSourcePack([source({ agentUseAllowed: false }, { importedAt: daysAgo(400) })], NOW)

    expect(pack.entries[0]!.freshness).toBe('stale')
    expect(pack.staleInUse).toBe(0)
  })

  it('recomputes the age rather than trusting the DTO field', () => {
    // Both derive from the import time; one definition is what stops the age and
    // the label disagreeing on the boundary day.
    const stated = source({ freshness: 'current' }, { importedAt: daysAgo(400) })

    expect(buildSourcePack([stated], NOW).entries[0]!.freshness).toBe('stale')
  })
})

describe('the pack an owner is looking at', () => {
  it('is empty rather than ready when nothing was ever imported', () => {
    expect(buildSourcePack([], NOW)).toMatchObject({ state: 'empty', entries: [], inUse: 0 })
  })

  it('keeps a revoked source visible', () => {
    // A draft that cited it stays explainable only while the owner can still see
    // that it existed.
    const pack = buildSourcePack([source({ revokedAt: daysAgo(2) })], NOW)

    expect(pack.entries).toHaveLength(1)
    expect(pack.entries[0]!.revokedAt).toBe(daysAgo(2))
    expect(pack.revoked).toBe(1)
    expect(pack.inUse).toBe(0)
  })

  it('counts each blocked state separately, because they need different actions', () => {
    const pack = buildSourcePack([
      source({ id: 'a' }),
      source({ id: 'b' }, { approvedAt: null }),
      source({ id: 'c', agentUseAllowed: false }),
      source({ id: 'd', revokedAt: daysAgo(1) }),
    ], NOW)

    expect(pack).toMatchObject({ state: 'ready', inUse: 1, awaitingApproval: 1, revoked: 1 })
    expect(pack.entries.map(entry => entry.usability))
      .toEqual(['in-use', 'awaiting-approval', 'not-permitted', 'revoked'])
  })

  it('preserves the order it was handed', () => {
    // The store orders by created_at desc; re-sorting here would silently
    // disagree with what the API returns.
    const pack = buildSourcePack([source({ id: 'z' }), source({ id: 'a' })], NOW)

    expect(pack.entries.map(entry => entry.id)).toEqual(['z', 'a'])
  })

  it('states the staleness threshold, so the copy need not hardcode it', () => {
    expect(buildSourcePack([], NOW).staleAfterDays).toBe(STALE_AFTER_DAYS)
  })
})
