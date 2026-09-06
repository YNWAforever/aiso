import { describe, expect, it } from 'vitest'

import { encodeObservationCursor, parseObservationQuery } from '@/lib/observations/query'

const ID = '00000000-0000-4000-8000-000000000001'

describe('parseObservationQuery', () => {
  it('returns the bounded defaults', () => {
    expect(parseObservationQuery(new URLSearchParams())).toEqual({
      promptId: null,
      platform: null,
      week: null,
      result: null,
      limit: 50,
      cursor: null,
    })
  })

  it.each(['limit=0', 'limit=101', 'limit=1.5', 'limit=01', 'limit='])('rejects an invalid limit: %s', query => {
    expect(() => parseObservationQuery(new URLSearchParams(query))).toThrow()
  })

  it.each(['week=2026-02-30', 'week=2025-02-29', 'week=2026-2-01', 'week='])('rejects an invalid calendar week: %s', query => {
    expect(() => parseObservationQuery(new URLSearchParams(query))).toThrow()
  })

  it('accepts a canonical leap-day week', () => {
    expect(parseObservationQuery(new URLSearchParams('week=2024-02-29')).week).toBe('2024-02-29')
  })

  it.each(['promptId=nope', 'promptId=00000000-0000-0000-0000-000000000000'])('rejects an invalid prompt UUID: %s', query => {
    expect(() => parseObservationQuery(new URLSearchParams(query))).toThrow()
  })

  it('lowercases UUID filters', () => {
    const query = parseObservationQuery(new URLSearchParams(`promptId=${ID.toUpperCase()}`))
    expect(query.promptId).toBe(ID)
  })

  it.each(['platform=', `platform=${'x'.repeat(81)}`])('rejects an invalid platform: %s', query => {
    expect(() => parseObservationQuery(new URLSearchParams(query))).toThrow()
  })

  it.each(['unknown=value', 'limit=1&limit=2', 'week=2026-09-01&week=2026-09-01'])('rejects unknown or repeated query keys: %s', query => {
    expect(() => parseObservationQuery(new URLSearchParams(query))).toThrow()
  })

  it('round-trips a cursor without losing PostgreSQL microseconds', () => {
    const cursor = { recordedAt: '2026-09-01T10:11:12.123456+00:00', id: ID }
    const encoded = encodeObservationCursor(cursor)
    const parsed = parseObservationQuery(new URLSearchParams({ week: '2026-09-01', cursor: encoded }))
    expect(parsed.cursor).toEqual(cursor)
  })

  it('round-trips the null timestamp sentinel and lowercases its UUID', () => {
    const encoded = Buffer.from(JSON.stringify({ recordedAt: null, id: ID.toUpperCase() })).toString('base64url')
    expect(parseObservationQuery(new URLSearchParams({ week: '2026-09-01', cursor: encoded })).cursor).toEqual({
      recordedAt: null,
      id: ID,
    })
  })

  it.each([
    `week=2026-09-01&cursor=${'a'.repeat(513)}`,
    `week=2026-09-01&cursor=${Buffer.from('{}').toString('base64url')}`,
    `week=2026-09-01&cursor=${Buffer.from(JSON.stringify({ recordedAt: 'not-a-date', id: ID })).toString('base64url')}`,
    `week=2026-09-01&cursor=${Buffer.from(JSON.stringify({ recordedAt: null, id: 'bad' })).toString('base64url')}`,
  ])('rejects a malformed or oversized cursor', query => {
    expect(() => parseObservationQuery(new URLSearchParams(query))).toThrow()
  })

  it('rejects a cursor unless the week is explicit', () => {
    const cursor = encodeObservationCursor({ recordedAt: null, id: ID })
    expect(() => parseObservationQuery(new URLSearchParams({ cursor }))).toThrow()
  })
})
