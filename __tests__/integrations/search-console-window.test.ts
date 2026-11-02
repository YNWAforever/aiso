import { describe, expect, it } from 'vitest'
import { GSC_ANSWER_DAYS, GSC_DATA_LAG_DAYS, gscAnswerWindow, pacificCalendarDate } from '@/lib/integrations/search-console/window'

describe('pacificCalendarDate', () => {
  it('uses the Pacific calendar, not a naive UTC slice', () => {
    const morningUtc = new Date('2026-11-03T00:30:00Z')
    expect(morningUtc.toISOString().slice(0, 10)).toBe('2026-11-03')
    expect(pacificCalendarDate(morningUtc)).toBe('2026-11-02')
  })

  it('is stable across PST and PDT', () => {
    expect(pacificCalendarDate(new Date('2026-01-15T20:00:00Z'))).toBe('2026-01-15')
    expect(pacificCalendarDate(new Date('2026-07-15T20:00:00Z'))).toBe('2026-07-15')
    expect(pacificCalendarDate(new Date('2026-07-16T06:30:00Z'))).toBe('2026-07-15')
  })

  it('handles the evening-HKT / morning-UTC boundary', () => {
    expect(pacificCalendarDate(new Date('2026-07-15T20:00:00Z'))).toBe('2026-07-15')
    expect(pacificCalendarDate(new Date('2026-07-15T23:30:00Z'))).toBe('2026-07-15')
  })
})

describe('gscAnswerWindow', () => {
  it('ends three Pacific days back and spans 28 days by default', () => {
    const window = gscAnswerWindow({ now: new Date('2026-11-02T18:00:00Z') })
    expect(window).toEqual({
      pacificToday: '2026-11-02', endDate: '2026-10-30', startDate: '2026-10-03',
      lagDays: GSC_DATA_LAG_DAYS, completeThrough: '2026-10-30',
    })
    expect(GSC_DATA_LAG_DAYS).toBe(3)
    expect(GSC_ANSWER_DAYS).toBe(28)
  })

  it('clamps an explicit lag and window length', () => {
    const window = gscAnswerWindow({ now: new Date('2026-11-02T18:00:00Z'), days: 7, lagDays: 0 })
    expect(window.startDate).toBe('2026-10-27')
    expect(window.endDate).toBe('2026-11-02')
    expect(window.completeThrough).toBe('2026-11-02')
  })

  it('does not use the UTC date of an evening-HKT turn', () => {
    const window = gscAnswerWindow({ now: new Date('2026-11-03T00:30:00Z') })
    expect(window.pacificToday).toBe('2026-11-02')
    expect(window.pacificToday).not.toBe('2026-11-03')
  })
})
