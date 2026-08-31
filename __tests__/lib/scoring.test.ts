import { describe, expect, it } from 'vitest'
import { capScore } from '@/lib/scoring'

describe('capScore', () => {
  it('passes values at or below 100 through unchanged', () => {
    expect(capScore(0)).toBe(0)
    expect(capScore(87.5)).toBe(87.5)
    expect(capScore(100)).toBe(100)
  })

  it('caps values above 100 at exactly 100', () => {
    expect(capScore(100.1)).toBe(100)
    expect(capScore(140)).toBe(100)
  })
})
