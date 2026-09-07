import { describe, expect, it, vi } from 'vitest'
import { parseAttest, parseWithdraw, parseDeliveryQuery, parseExportFormat } from '@/lib/delivery/input'
import { attestInput, ID, REQUEST_ID } from './fixtures'
vi.mock('server-only', () => ({}))
const invalid = 'INVALID_DELIVERY_INPUT'
const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
describe('delivery inputs', () => {
  it('normalizes offset-equivalent requests, UUIDs, NFC and CRLF', () => {
    expect(parseAttest({ ...attestInput(), destination: ' Site ', note: ' e\u0301\r\n你好 ', deliveredAt: '2026-09-07T08:00:00+08:00', requestId: REQUEST_ID.toUpperCase() }))
      .toEqual({ ...attestInput(), note: 'é\n你好' })
    expect(parseWithdraw({ reason: ' e\u0301\r\n理由 ', requestId: REQUEST_ID.toUpperCase() })).toEqual({ reason: 'é\n理由', requestId: REQUEST_ID })
  })
  it.each(['2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '1900-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z', '2026-09-07', '2026-09-07T00:00:00', '2026-09-07T24:00:00Z', '2026-09-07T00:60:00Z', '2026-09-07T00:00:60Z', '2026-09-07T00:00:00+24:00', '2026-09-07T00:00:00+08:60', '2026-09-07T00:00:00.1234Z'])('rejects invalid date %s', deliveredAt => {
    expect(() => parseAttest({ ...attestInput(), deliveredAt })).toThrow(invalid)
  })
  it.each(['2000-02-29T00:00:00Z', '2024-02-29T00:00:00.1Z', '2026-09-07T00:00:00.12-05:30'])('accepts valid Gregorian instants %s', deliveredAt => {
    expect(parseAttest({ ...attestInput(), deliveredAt }).deliveredAt).toBe(new Date(deliveredAt).toISOString())
  })
  it('counts code points at destination and note/reason boundaries', () => {
    expect(parseAttest({ ...attestInput(), destination: '😀'.repeat(500), note: '😀'.repeat(2000) }).note).toHaveLength(4000)
    expect(parseWithdraw({ reason: '😀'.repeat(2000), requestId: REQUEST_ID }).reason).toHaveLength(4000)
    expect(() => parseAttest({ ...attestInput(), destination: '😀'.repeat(501) })).toThrow(invalid)
    expect(() => parseAttest({ ...attestInput(), note: '😀'.repeat(2001) })).toThrow(invalid)
    expect(() => parseWithdraw({ reason: '😀'.repeat(2001), requestId: REQUEST_ID })).toThrow(invalid)
  })
  it.each(['', ' ', 'a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a\u007fb', 'a\u0085b', 'a\ud800b', 'a\u2028b'])('rejects invalid destination %j', destination => {
    expect(() => parseAttest({ ...attestInput(), destination })).toThrow(invalid)
  })
  it.each(['', ' ', 'a\rb', 'a\tb', 'a\u0000b', 'a\u007fb', 'a\u0085b', 'a\ud800b'])('rejects invalid note/reason %j', note => {
    expect(() => parseAttest({ ...attestInput(), note })).toThrow(invalid)
    expect(() => parseWithdraw({ reason: note, requestId: REQUEST_ID })).toThrow(invalid)
  })
  it.each([null, [], {}, { ...attestInput(), actorId: ID }, { ...attestInput(), requestId: 'bad' }, { ...attestInput(), contentHash: 'A'.repeat(64) }, { ...attestInput(), contentHash: 'a'.repeat(63) }])('rejects malformed or extra attest fields', value => {
    expect(() => parseAttest(value)).toThrow(invalid)
  })
  it('rejects missing, extra and oversized withdrawal fields', () => {
    for (const value of [{ reason: 'why' }, { reason: 'why', requestId: REQUEST_ID, actor: ID }, { reason: ' '.repeat(17000), requestId: REQUEST_ID }]) expect(() => parseWithdraw(value)).toThrow(invalid)
    expect(() => parseAttest({ ...attestInput(), note: ' '.repeat(17000) })).toThrow(invalid)
  })
})
describe('delivery queries', () => {
  it('defaults and preserves the microsecond cursor', () => {
    expect(parseDeliveryQuery(new URLSearchParams())).toEqual({ limit: 20, cursor: null })
    const value = { recordedAt: '2026-09-07T01:00:00.123456Z', id: ID }
    expect(parseDeliveryQuery(new URLSearchParams({ limit: '50', cursor: cursor(value) }))).toEqual({ limit: 50, cursor: value })
    expect(parseExportFormat(new URLSearchParams())).toBe('json')
    expect(parseExportFormat(new URLSearchParams('format=text'))).toBe('text')
  })
  it.each(['limit=0', 'limit=51', 'limit=1.5', 'limit=9007199254740993', 'limit=01', 'limit=', 'limit=2&limit=2', 'x=1', 'cursor=', 'cursor=a&cursor=b'])('rejects query %s', query => {
    expect(() => parseDeliveryQuery(new URLSearchParams(query))).toThrow(invalid)
  })
  it.each([{ recordedAt: '2026-02-30T00:00:00.123456Z', id: ID }, { recordedAt: '2026-09-07', id: ID }, { recordedAt: '2026-09-07T00:00:00.123456Z', id: 'bad' }, { recordedAt: '2026-09-07T00:00:00.123456Z', id: ID, extra: true }, null, []])('rejects tampered cursor values', value => {
    expect(() => parseDeliveryQuery(new URLSearchParams({ cursor: cursor(value) }))).toThrow(invalid)
  })
  it.each(['***', 'e30=', 'a'.repeat(1025), Buffer.from([0xff]).toString('base64url')])('rejects malformed cursor encoding', value => {
    expect(() => parseDeliveryQuery(new URLSearchParams({ cursor: value }))).toThrow(invalid)
  })
  it.each(['format=xml', 'format=', 'format=json&format=json', 'limit=1'])('rejects export query %s', query => {
    expect(() => parseExportFormat(new URLSearchParams(query))).toThrow(invalid)
  })
})

it('requires delivery timestamps to be strings at the mutation boundary', () => {
  expect(() => parseAttest({ ...attestInput(), deliveredAt: new Date('2026-09-07T00:00:00Z') })).toThrow('INVALID_DELIVERY_INPUT')
})
