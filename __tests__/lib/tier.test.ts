import { describe, it, expect } from 'vitest'
import { planAllows, TIER_FEATURES } from '@/lib/tier'

describe('planAllows', () => {
  it('starter cannot edit prompts', () => {
    expect(planAllows('starter', 'editPrompts')).toBe(false)
  })
  it('pro can edit prompts', () => {
    expect(planAllows('pro', 'editPrompts')).toBe(true)
  })
  it('enterprise can edit prompts', () => {
    expect(planAllows('enterprise', 'editPrompts')).toBe(true)
  })
  it('starter has 4-week history', () => {
    expect(TIER_FEATURES.starter.historyWeeks).toBe(4)
  })
  it('pro has 26-week history', () => {
    expect(TIER_FEATURES.pro.historyWeeks).toBe(26)
  })
  it('enterprise has max brands 10', () => {
    expect(TIER_FEATURES.enterprise.maxBrands).toBe(10)
  })
  it('unknown plan returns false', () => {
    expect(planAllows('unknown', 'editPrompts')).toBe(false)
  })
})
