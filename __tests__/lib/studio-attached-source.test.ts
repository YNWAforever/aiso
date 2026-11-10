import { describe, expect, it } from 'vitest'
import { describeAttachedSource } from '@/lib/conversation-studio/attachment-view'

const documents = {
  truncated: false,
  items: [
    { id: 'source-1', label: 'Brand FAQ', versionId: 'version-3', versionNumber: 3, approvedAt: '2026-11-01T00:00:00Z', importedAt: '2026-10-01T00:00:00Z' },
    { id: 'source-2', label: 'Old page', versionId: 'version-1', versionNumber: 1, approvedAt: '2026-10-01T00:00:00Z', importedAt: '2026-09-01T00:00:00Z' },
  ],
}

describe('describeAttachedSource', () => {
  it('returns nothing when the turn recorded no attachment', () => {
    expect(describeAttachedSource({ attached: null, documents })).toBeNull()
    expect(describeAttachedSource({ attached: undefined, liveAttachment: null, documents: undefined })).toBeNull()
  })

  it('keeps a saved-path attachment honest: recorded, never claimed as read', () => {
    const view = describeAttachedSource({ attached: { label: 'Brand FAQ', versionNumber: 3 }, documents })!
    expect(view).toMatchObject({
      label: 'Brand FAQ',
      kind: 'recorded',
      usedVersionNumber: 3,
      usedVersionId: null,
      contentHash: null,
      entriesIncluded: null,
      currentVersionNumber: 3,
      stale: false,
    })
  })

  it('carries the LIVE answer metadata and flags the current approved version', () => {
    const view = describeAttachedSource({
      attached: { label: 'Brand FAQ', versionNumber: 3 },
      liveAttachment: {
        sourceId: 'source-1', label: 'Brand FAQ', versionId: 'version-3', versionNumber: 3,
        contentHash: 'abcdef0123456789', entriesIncluded: 4, entriesTotal: 6, truncated: true, characters: 800,
      },
      documents,
    })!
    expect(view).toMatchObject({
      kind: 'live',
      usedVersionId: 'version-3',
      contentHash: 'abcdef0123456789',
      entriesIncluded: 4,
      entriesTotal: 6,
      truncated: true,
      currentVersionNumber: 3,
      stale: false,
    })
  })

  it('flags a source that has a newer approved version, and one whose version id changed at the same number', () => {
    const newer = describeAttachedSource({
      liveAttachment: {
        sourceId: 'source-2', label: 'Old page', versionId: 'version-1', versionNumber: 1,
        contentHash: 'aaaa', entriesIncluded: 1, entriesTotal: 1, truncated: false, characters: 10,
      },
      documents: { ...documents, items: [{ ...documents.items[1]!, versionId: 'version-2', versionNumber: 2 }] },
    })!
    expect(newer.currentVersionNumber).toBe(2)
    expect(newer.stale).toBe(true)

    const sameNumber = describeAttachedSource({
      liveAttachment: {
        sourceId: 'source-2', label: 'Old page', versionId: 'version-1', versionNumber: 1,
        contentHash: 'aaaa', entriesIncluded: 1, entriesTotal: 1, truncated: false, characters: 10,
      },
      documents,
    })!
    expect(sameNumber.stale).toBe(false)
  })

  it('never matches by an ambiguous label and never invents a version without documents', () => {
    const ambiguous = describeAttachedSource({
      attached: { label: 'Same label', versionNumber: 1 },
      documents: { truncated: false, items: [
        { ...documents.items[0]!, id: 'a', label: 'Same label' },
        { ...documents.items[1]!, id: 'b', label: 'Same label' },
      ] },
    })!
    expect(ambiguous.currentVersionNumber).toBeNull()
    expect(ambiguous.currentVersionId).toBeNull()
    expect(ambiguous.stale).toBe(false)

    const unknown = describeAttachedSource({ attached: { label: 'Missing source', versionNumber: 2 }, documents: null })!
    expect(unknown.currentVersionNumber).toBeNull()
    expect(unknown.stale).toBe(false)
  })
})
