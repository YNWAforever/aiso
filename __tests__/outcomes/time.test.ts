import { expect, test } from 'vitest'
import { utcMicros, formatUtcMicros } from '@/lib/outcomes/time'
test('preserves microseconds and normalizes fractional precision', () => {
  expect(utcMicros('2026-09-14T00:00:00.000001Z') - utcMicros('2026-09-14T00:00:00Z')).toBe(BigInt(1))
  for (const fraction of ['', '.1', '.12', '.123', '.1234', '.12345', '.123456']) expect(formatUtcMicros(utcMicros(`2026-09-14T00:00:00${fraction}Z`))).toBe(`2026-09-14T00:00:00.${fraction.slice(1).padEnd(6, '0')}Z`)
})
test.each(['2026-02-30T00:00:00Z','2026-02-29T00:00:00Z','2026-13-01T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T00:60:00Z','2026-01-01T00:00:60Z','2026-01-01T00:00:00+00:00','2026-01-01T00:00:00.1234567Z','Infinity','2026-01-01'])('rejects invalid UTC %s', value => expect(() => utcMicros(value)).toThrow())
test.each(['0000-01-01T00:00:00.000001Z','1969-12-31T23:59:59.999999Z','2000-02-29T00:00:00.000000Z','9999-12-31T23:59:59.999999Z'])('round trips %s', value => expect(formatUtcMicros(utcMicros(value))).toBe(value))
test('rejects out of range formatted time', () => expect(() => formatUtcMicros(BigInt(10) ** BigInt(30))).toThrow())
