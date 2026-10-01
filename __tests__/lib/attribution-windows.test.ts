import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { addDays, deliveryDay, hkToday, readyOn, windowsFor } from '@/lib/attribution/windows'
import { LAG_DAYS, MEASURE_PAGES_MAX, WINDOW_DAYS } from '@/lib/attribution/types'

describe('deliveryDay', () => {
  it('is the Hong Kong calendar date, which is eight hours ahead of UTC', () => {
    expect(deliveryDay('2026-09-11T16:30:00Z')).toBe('2026-09-12')
    expect(deliveryDay('2026-09-11T15:59:59Z')).toBe('2026-09-11')
  })

  it('reads an offset timestamp as the instant it names', () => {
    expect(deliveryDay('2026-09-11T23:30:00-08:00')).toBe('2026-09-12')
  })
})

describe('hkToday', () => {
  it('rolls over at 16:00 UTC, not at local midnight', () => {
    expect(hkToday(new Date('2026-09-11T15:59:59Z'))).toBe('2026-09-11')
    expect(hkToday(new Date('2026-09-11T16:00:00Z'))).toBe('2026-09-12')
  })
})

describe('windowsFor', () => {
  it('gives two inclusive 28-day windows either side of the delivery day', () => {
    expect(windowsFor('2026-09-12')).toEqual({
      before: { from: '2026-08-15', to: '2026-09-11' },
      after: { from: '2026-09-13', to: '2026-10-10' },
    })
  })

  it('crosses month and year boundaries on the calendar, not by 30-day months', () => {
    expect(windowsFor('2026-01-10').before).toEqual({ from: '2025-12-13', to: '2026-01-09' })
    expect(windowsFor('2028-02-20').after).toEqual({ from: '2028-02-21', to: '2028-03-19' })
  })
})

describe('readyOn', () => {
  it('is the day after the after-window plus the reporting lag', () => {
    expect(readyOn('2026-09-12')).toBe('2026-10-13')
  })
})

describe('addDays', () => {
  it('does date arithmetic on the string and ignores the machine zone', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('constants', () => {
  it('keeps the window arithmetic tied to the named constants', () => {
    expect(WINDOW_DAYS).toBe(28)
    expect(LAG_DAYS).toBe(3)
    expect(readyOn('2026-09-12')).toBe(addDays('2026-09-12', WINDOW_DAYS + LAG_DAYS))
  })

  it('ties MEASURE_PAGES_MAX to the number migration 056 enforces', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/056_attribution.sql'),
      'utf8',
    )
    const m = sql.match(/pages between 1 and (\d+)/)
    expect(m, 'the shape trigger no longer states its page cap this way').not.toBeNull()
    expect(Number(m![1])).toBe(MEASURE_PAGES_MAX)
    expect(MEASURE_PAGES_MAX).toBe(20)
  })
})
