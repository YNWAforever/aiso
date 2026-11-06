import { describe, it, expect } from 'vitest'
import { periodOf, hongKongMonthKey, shiftMonth, isViewableMonth, dueSnapshots, asOfFor, CLOSE_GRACE_DAYS } from '@/lib/brand-month/period'

describe('Hong Kong month period', () => {
  it('starts and ends at Hong Kong midnight', () => {
    expect(periodOf('2026-11')).toEqual({ key: '2026-11', month: '2026-11-01', start: '2026-10-31T16:00:00.000Z', end: '2026-11-30T16:00:00.000Z' })
    expect(periodOf('2026-12')!.end).toBe('2026-12-31T16:00:00.000Z')
  })
  it('refuses anything that is not YYYY-MM', () => {
    for (const bad of ['2026-13', '2026-1', '26-11', '2026-11-01', '', 'abcd-ef']) expect(periodOf(bad)).toBeNull()
  })
  it('puts an instant in its Hong Kong month, not its UTC one', () => {
    expect(hongKongMonthKey(new Date('2026-10-31T15:59:59Z'))).toBe('2026-10')
    expect(hongKongMonthKey(new Date('2026-10-31T16:00:00Z'))).toBe('2026-11')
  })
  it('shifts across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-11', 2)).toBe('2027-01')
  })
  it('only shows months that have started and are within the lookback', () => {
    const now = new Date('2026-11-06T09:00:00Z')
    expect(isViewableMonth('2026-11', now)).toBe(true)
    expect(isViewableMonth('2025-11', now)).toBe(true)
    expect(isViewableMonth('2025-10', now)).toBe(false)
    expect(isViewableMonth('2026-12', now)).toBe(false)
    expect(isViewableMonth('2026-1', now)).toBe(false)
  })
  it('opens at the boundary and closes only after the grace days', () => {
    const p = periodOf('2026-11')!
    expect(dueSnapshots(p, new Date('2026-10-31T15:59:59Z'))).toEqual([])
    expect(dueSnapshots(p, new Date(p.start))).toEqual(['opening'])
    const close = Date.parse(p.end) + CLOSE_GRACE_DAYS * 86_400_000
    expect(dueSnapshots(p, new Date(close - 1))).toEqual(['opening'])
    expect(dueSnapshots(p, new Date(close))).toEqual(['opening', 'closing'])
    expect(asOfFor(p, 'opening')).toBe(p.start)
    expect(asOfFor(p, 'closing')).toBe(p.end)
  })
})
