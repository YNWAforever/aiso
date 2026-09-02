import { describe, expect, it } from 'vitest'

import { cellId, compareCounts } from '../../tests/e2e/a11y/baseline'

describe('cellId', () => {
  it('identifies a route, theme and viewport', () => {
    expect(cellId('/en', 'dark', '375')).toBe('/en | dark | 375')
  })

  // Viewport is part of the identity because a responsive layout can hide at
  // 375 what it shows at 1440, so the same rule legitimately has different
  // counts per width.
  it('distinguishes viewports', () => {
    expect(cellId('/en', 'dark', '375')).not.toBe(cellId('/en', 'dark', '1440'))
  })

  it('distinguishes themes and routes', () => {
    expect(cellId('/en', 'dark', '375')).not.toBe(cellId('/en', 'light', '375'))
    expect(cellId('/en', 'dark', '375')).not.toBe(cellId('/zh-HK', 'dark', '375'))
  })
})

describe('compareCounts', () => {
  it('passes when counts match exactly', () => {
    expect(compareCounts({ 'color-contrast': 3 }, { 'color-contrast': 3 })).toEqual({
      exceeded: [],
      improved: [],
    })
  })

  // The gate.
  it('fails when a count rises', () => {
    const result = compareCounts({ 'color-contrast': 4 }, { 'color-contrast': 3 })
    expect(result.exceeded).toEqual([{ rule: 'color-contrast', accepted: 3, observed: 4 }])
    expect(result.improved).toEqual([])
  })

  it('fails when a rule is entirely new', () => {
    const result = compareCounts({ region: 1 }, {})
    expect(result.exceeded).toEqual([{ rule: 'region', accepted: 0, observed: 1 }])
  })

  // The anti-rot half. A baseline that never shrinks becomes a blanket amnesty.
  it('fails when a count falls', () => {
    const result = compareCounts({ 'color-contrast': 2 }, { 'color-contrast': 3 })
    expect(result.improved).toEqual([{ rule: 'color-contrast', accepted: 3, observed: 2 }])
    expect(result.exceeded).toEqual([])
  })

  it('fails when a rule stops firing entirely', () => {
    const result = compareCounts({}, { region: 4 })
    expect(result.improved).toEqual([{ rule: 'region', accepted: 4, observed: 0 }])
  })

  it('reports both directions at once', () => {
    const result = compareCounts(
      { 'color-contrast': 5, region: 1 },
      { 'color-contrast': 3, region: 4 },
    )
    expect(result.exceeded).toEqual([{ rule: 'color-contrast', accepted: 3, observed: 5 }])
    expect(result.improved).toEqual([{ rule: 'region', accepted: 4, observed: 1 }])
  })

  it('is empty for two empty inputs', () => {
    expect(compareCounts({}, {})).toEqual({ exceeded: [], improved: [] })
  })
})
