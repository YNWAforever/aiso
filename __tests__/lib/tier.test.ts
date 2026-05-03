import { describe, it, expect } from 'vitest'
import { planAllows, getPlanFeatures } from '@/lib/tier'

describe('planAllows', () => {
  it('basic cannot edit prompts', () => {
    expect(planAllows('basic', 'edit_prompts')).toBe(false)
  })
  it('pro can edit prompts', () => {
    expect(planAllows('pro', 'edit_prompts')).toBe(true)
  })
  it('enterprise can edit prompts', () => {
    expect(planAllows('enterprise', 'edit_prompts')).toBe(true)
  })
  it('basic has 4-week history', () => {
    expect(getPlanFeatures('basic').history_weeks).toBe(4)
  })
  it('pro has 26-week history', () => {
    expect(getPlanFeatures('pro').history_weeks).toBe(26)
  })
  it('enterprise has max brands 10', () => {
    expect(getPlanFeatures('enterprise').max_brands).toBe(10)
  })
  it('unknown plan returns false', () => {
    expect(planAllows('unknown', 'edit_prompts')).toBe(false)
  })
})
