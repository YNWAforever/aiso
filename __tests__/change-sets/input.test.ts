import { describe, expect, it } from 'vitest'
import { parseSubmission, parseVersionQuery } from '@/lib/change-sets/input'

describe('change-set input contracts', () => {
  it('accepts only a positive safe persisted revision', () => {
    expect(parseSubmission({ expectedRevision: 1 })).toEqual({ expectedRevision: 1 })
    expect(parseSubmission({ expectedRevision: Number.MAX_SAFE_INTEGER })).toEqual({ expectedRevision: Number.MAX_SAFE_INTEGER })
  })

  it.each([
    null,
    [],
    {},
    { expectedRevision: 1, accountId: 'forged' },
    { expectedRevision: 0 },
    { expectedRevision: -1 },
    { expectedRevision: 1.5 },
    { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { expectedRevision: '1' },
  ])('rejects invalid submission input %#', (input) => {
    expect(() => parseSubmission(input)).toThrow('INVALID_CHANGE_SET_INPUT')
  })

  it('parses a strict bounded version query', () => {
    expect(parseVersionQuery(new URLSearchParams())).toEqual({ limit: 20, cursor: null })
    expect(parseVersionQuery(new URLSearchParams({ limit: '50', cursor: 'opaque-cursor' })))
      .toEqual({ limit: 50, cursor: 'opaque-cursor' })
  })

  it.each([
    'limit=0',
    'limit=51',
    'limit=1.5',
    'limit=01',
    'limit=1&limit=2',
    'cursor=',
    'cursor=a&cursor=b',
    'unknown=x',
  ])('rejects an invalid version query: %s', (query) => {
    expect(() => parseVersionQuery(new URLSearchParams(query))).toThrow('INVALID_CHANGE_SET_INPUT')
  })
})
