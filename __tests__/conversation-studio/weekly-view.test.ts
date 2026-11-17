import { describe, expect, it } from 'vitest'
import type { StudioWeek } from '@/lib/conversation-studio/overview'
import { summarizeStudioWeeks, weekPercent } from '@/lib/conversation-studio/weekly-view'

const week = (date: string, sovScore: number, totalQueries = 40, brandMentions = 15): StudioWeek =>
  ({ week: date, sovScore, brandMentions, totalQueries })

describe('Studio weekly view model', () => {
  it('sorts newest first and compares the two newest saved weeks', () => {
    const summary = summarizeStudioWeeks([
      week('2026-10-12', 22.5, 40, 9),
      week('2026-10-26', 37.5),
      week('2026-10-19', 30, 40, 12),
    ])
    expect(summary?.weeks.map(item => item.week)).toEqual(['2026-10-26', '2026-10-19', '2026-10-12'])
    expect(summary?.latest.week).toBe('2026-10-26')
    expect(summary?.previous?.week).toBe('2026-10-19')
    expect(summary?.delta).toBe(7.5)
  })

  it('returns no delta for one week, empty data, or a week with no answers', () => {
    expect(summarizeStudioWeeks([])).toBeNull()
    expect(summarizeStudioWeeks([week('2026-10-26', 37.5)])?.delta).toBeNull()
    expect(summarizeStudioWeeks([week('2026-10-26', 0, 0, 0), week('2026-10-19', 30)])?.delta).toBeNull()
    expect(summarizeStudioWeeks([week('2026-10-26', 37.5), week('2026-10-19', 0, 0, 0)])?.delta).toBeNull()
    expect(weekPercent(week('2026-10-26', 0, 0, 0))).toBeNull()
  })

  it('keeps negative, flat, and gapped-week comparisons honest', () => {
    const down = summarizeStudioWeeks([week('2026-10-26', 20), week('2026-10-05', 37.5)])
    expect(down?.delta).toBe(-17.5)
    expect(down?.previous?.week).toBe('2026-10-05')

    expect(summarizeStudioWeeks([week('2026-10-26', 30), week('2026-10-19', 30)])?.delta).toBe(0)
  })

  it('never formats an unreadable week as a number', () => {
    expect(weekPercent(week('2026-10-26', 37.55))).toBe(37.6)
    expect(weekPercent({ ...week('2026-10-26', Number.NaN) })).toBeNull()
    expect(weekPercent({ ...week('2026-10-26', 37.5), totalQueries: Number.NaN })).toBeNull()
  })
})
