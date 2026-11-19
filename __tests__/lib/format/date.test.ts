import { describe, expect, it } from 'vitest'
import { formatDisplayDate } from '@/lib/format/date'
import { studioDate } from '@/lib/conversation-studio/format-date'

describe('formatDisplayDate', () => {
  it('never returns a raw ISO or Postgres timestamp', () => {
    for (const value of ['2026-11-18T03:47:12.123Z', '2026-11-18 03:47:12+00', '2026-11-18T03:47:12Z']) {
      const shown = formatDisplayDate(value, 'en', { withTime: true })
      expect(shown).not.toMatch(/\d{4}-\d{2}-\d{2}|T\d{2}:|Z$/)
      expect(shown).toContain('2026')
    }
  })
  it('shows instants in Hong Kong time and labels the zone only when asked', () => {
    // 03:47 UTC is 11:47 in Hong Kong.
    expect(formatDisplayDate('2026-11-18T03:47:00Z', 'en', { withTime: true })).toMatch(/11:47/)
    expect(formatDisplayDate('2026-11-18T03:47:00Z', 'en', { withTime: true, zoneLabel: true })).toMatch(/HKT$/)
    expect(formatDisplayDate('2026-11-18T03:47:00Z', 'zh-HK', { withTime: true, zoneLabel: true })).toMatch(/（香港時間）$/)
  })
  it('keeps a bare calendar date on that date and never adds a time or zone', () => {
    // Late-evening UTC must not roll a bare date forward.
    expect(formatDisplayDate('2026-10-28', 'en', { withTime: true, zoneLabel: true })).toBe('28 Oct 2026')
  })
  it('returns empty for no value and the input for an unparseable value', () => {
    expect(formatDisplayDate(null, 'en')).toBe('')
    expect(formatDisplayDate('not a date', 'en')).toBe('not a date')
  })
  it('studioDate is the same formatter without a zone label', () => {
    expect(studioDate('2026-11-18T03:47:00Z', 'zh-HK', true)).toBe(formatDisplayDate('2026-11-18T03:47:00Z', 'zh-HK', { withTime: true }))
  })
})

// Regression (production, 2026-11-19): the Neon driver returns timestamptz columns as
// Date objects although row types declare string, and `.replace` on a Date crashed
// the Results page. The same instant must format identically either way.
describe('Date objects from the database driver', () => {
  it('formats a Date exactly like its ISO string', () => {
    const instant = '2026-09-05T23:30:00.000Z'
    for (const locale of ['en', 'zh-HK']) {
      expect(formatDisplayDate(new Date(instant), locale)).toBe(formatDisplayDate(instant, locale))
      expect(formatDisplayDate(new Date(instant), locale, { withTime: true })).toBe(formatDisplayDate(instant, locale, { withTime: true }))
    }
  })
  it('returns empty for an invalid Date or a non-string value instead of throwing', () => {
    expect(formatDisplayDate(new Date('nope'), 'en')).toBe('')
    expect(formatDisplayDate(12345 as unknown as string, 'en')).toBe('')
  })
})
