import { describe, expect, it } from 'vitest'
import { normalizeEntityInput } from '@/lib/entities/schema'

describe('private entity input', () => {
  it('normalizes NFC and trims, excludes canonical name and deduplicates aliases', () => {
    expect(normalizeEntityInput({ displayName: ' Café ', aliases: ['Cafe\u0301', ' Alias ', 'ALIAS'], expectedRevision: 0 }))
      .toEqual({ displayName: 'Café', aliases: ['Alias'], expectedRevision: 0 })
  })
  it.each([
    {}, { displayName: '', aliases: [], expectedRevision: 0 },
    { displayName: 'x', aliases: [''], expectedRevision: 0 },
    { displayName: 'x'.repeat(121), aliases: [], expectedRevision: 0 },
    { displayName: 'x', aliases: Array(21).fill('a'), expectedRevision: 0 },
    { displayName: 'x', aliases: [42], expectedRevision: 0 },
    { displayName: 'x', aliases: [], expectedRevision: -1 },
    { displayName: 'x', aliases: [], expectedRevision: 1.5 },
    { displayName: 'x', aliases: [], expectedRevision: 0, accountId: 'foreign' },
  ])('rejects invalid input %j', input => expect(() => normalizeEntityInput(input)).toThrow())
  it('counts Unicode characters rather than UTF-16 code units', () => {
    expect(normalizeEntityInput({displayName: '😀'.repeat(120), aliases: [], expectedRevision: 0}).displayName).toHaveLength(240)
  })
})
