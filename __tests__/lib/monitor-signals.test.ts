import { describe, expect, it } from 'vitest'
import { buildCompetitorBars, buildPlatformGrid, monitorStatus, GRID_WEEKS } from '@/lib/view-models/monitor-signals'

const weeks = Array.from({ length: 10 }, (_, i) => `2026-08-${String(i * 3 + 1).padStart(2, '0')}`)
const series = (platform: string | null, sov: (number | null)[]) => ({ platform, points: weeks.map((week, i) => ({ week, sov: sov[i] ?? null })) })

describe('platform grid', () => {
  it('keeps the last eight weeks, names platforms in a fixed order and never claims a citation', () => {
    const grid = buildPlatformGrid([series(null, []), series('gemini-flash', [0, 0, 0, 0, 0, 0, 0, 0, 0, 20]), series('gpt-4o', [null, null, 10, 0])])!
    expect(grid.weeks).toEqual(weeks.slice(-GRID_WEEKS))
    expect(grid.platforms).toEqual([{ id: 'gpt-4o', name: 'ChatGPT' }, { id: 'gemini-flash', name: 'Gemini' }])
    expect(grid.cells['gemini-flash']!.at(-1)).toBe('mentioned')
    expect(grid.cells['gemini-flash']![0]).toBe('absent')
    expect(grid.cells['gpt-4o']![0]).toBe('mentioned')
    expect(grid.cells['gpt-4o']!.at(-1)).toBe('notRun')
    expect(Object.values(grid.cells).flat()).not.toContain('cited')
  })
  it('is null with only the aggregate series', () => {
    expect(buildPlatformGrid([series(null, [10])])).toBeNull()
  })
})

describe('competitor bars', () => {
  it('keeps the brand first and at most five competitors, as a share of answers', () => {
    const rows = [
      { name: null, mentions: 4, answers: 20 },
      ...['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({ name, mentions: 10 - i, answers: 20 })),
      { name: 'Z', mentions: 0, answers: 20 },
    ]
    const bars = buildCompetitorBars(rows)!
    expect(bars[0]).toEqual({ name: null, mentions: 4, share: 20 })
    expect(bars.slice(1).map(b => b.name)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(bars[1]!.share).toBe(50)
  })
  it('is null without classified answers, so zero is never drawn as a measurement', () => {
    expect(buildCompetitorBars([{ name: null, mentions: 0, answers: 0 }])).toBeNull()
    expect(buildCompetitorBars(undefined)).toBeNull()
  })
})

describe('monitor status', () => {
  const now = new Date('2026-10-23T00:00:00Z')
  it('calls results fresh only with a week from the last fortnight, and claims nothing about a schedule', () => {
    expect(monitorStatus('2026-10-19', now)).toEqual({ state: 'fresh', lastWeek: '2026-10-19' })
    expect(monitorStatus('2026-09-28', now)).toEqual({ state: 'stale', lastWeek: '2026-09-28' })
    expect(monitorStatus(null, now)).toEqual({ state: 'never', lastWeek: null })
  })
})
