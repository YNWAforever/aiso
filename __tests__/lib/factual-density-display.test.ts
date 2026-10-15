import { describe, expect, it } from 'vitest'
import { formatFactualDensityDetails } from '@/lib/score-display'

describe('saved factual-density detail display', () => {
  it.each([
    ['Quality score 20.018518518518515/100', 'Quality score 20.02/100'],
    ['Quality score 19.995121951219513/100', 'Quality score 20/100'],
    ['Quality score 10.500000000000002/100', 'Quality score 10.5/100'],
    ['Quality score 0/100', 'Quality score 0/100'],
    ['Quality score 100/100', 'Quality score 100/100'],
    ['Quality score NaN/100', 'Quality score NaN/100'],
    ['Quality score 101/100', 'Quality score 101/100'],
    ['2 chunks, avg score 24.5185185185/100', '2 chunks, avg score 24.5185185185/100'],
    ['Provider assessment unavailable', 'Provider assessment unavailable'],
  ])('projects %s without modifying its source', (stored, expected) => {
    expect(formatFactualDensityDetails(stored)).toBe(expected)
  })
})
