import { describe, expect, it } from 'vitest'

import { isoDate } from '@/lib/iso-date'

// Pin a positive-offset zone: at TZ=UTC a toISOString() implementation and a
// local-components one agree exactly, so the regression these tests exist for
// is undetectable there. CI runners default to UTC, which is precisely where
// this guard needs to work.
process.env.TZ = 'Asia/Hong_Kong'

describe('isoDate', () => {
  it('runs under the pinned timezone the date assertions depend on', () => {
    // If this fails, process.env.TZ above did not take effect -- Node worker
    // threads ignore a runtime mutation, so under Vitest's `threads` pool the
    // pin is a no-op and every assertion below silently degrades to the
    // UTC-blind version this file was written to replace. -480 is UTC+8.
    expect(new Date(2026, 7, 10).getTimezoneOffset()).toBe(-480)
  })

  it('passes a string date through unchanged', () => {
    // The HTTP driver returns `date` columns as 'YYYY-MM-DD' strings already.
    expect(isoDate('2026-08-10', 'fallback')).toBe('2026-08-10')
  })

  it('renders a Date as its LOCAL calendar day, not its UTC one', () => {
    // The bug this exists to prevent: a Postgres `date` has no time or zone, so
    // a parsing driver builds the Date at local midnight. toISOString() then
    // shifts to UTC and reports the previous day at any positive offset --
    // 2026-08-10 becomes 2026-08-09 in Hong Kong. Reading local components is
    // what makes the round-trip lossless in every timezone. The module-level
    // TZ pin above is why this reliably catches that shift instead of only
    // catching it on a developer machine that happens to sit east of UTC.
    const localMidnight = new Date(2026, 7, 10)

    expect(isoDate(localMidnight, 'fallback')).toBe('2026-08-10')
  })

  it('pads single-digit months and days', () => {
    expect(isoDate(new Date(2026, 0, 5), 'fallback')).toBe('2026-01-05')
  })

  it('falls back when the value is absent or not a date', () => {
    expect(isoDate(undefined, '2026-01-01')).toBe('2026-01-01')
    expect(isoDate(null, '2026-01-01')).toBe('2026-01-01')
    expect(isoDate('', '2026-01-01')).toBe('2026-01-01')
  })

  it('falls back on an invalid Date rather than rendering NaN-NaN-NaN', () => {
    // An unparseable Date still passes `instanceof Date` -- only getTime()
    // reveals it's invalid. Without the guard this renders 'NaN-NaN-NaN', a
    // string that typechecks as a date but is garbage as a dedup key.
    expect(isoDate(new Date('garbage'), '2026-01-01')).toBe('2026-01-01')
  })
})
