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

  it('basic cannot access Local Trust ROI', () => {
    expect(planAllows('basic', 'local_trust_roi')).toBe(false)
  })

  it('pro can access Local Trust ROI but not competitor snapshot or export', () => {
    expect(planAllows('pro', 'local_trust_roi')).toBe(true)
    expect(planAllows('pro', 'local_trust_competitors')).toBe(false)
    expect(planAllows('pro', 'local_trust_export')).toBe(false)
  })

  it('enterprise can access all Local Trust ROI features', () => {
    expect(planAllows('enterprise', 'local_trust_roi')).toBe(true)
    expect(planAllows('enterprise', 'local_trust_competitors')).toBe(true)
    expect(planAllows('enterprise', 'local_trust_export')).toBe(true)
  })

  it('keeps basic, pro, and enterprise feature boundaries explicit', () => {
    expect(planAllows('basic', 'agent_recs')).toBe(true)
    expect(planAllows('basic', 'alerts')).toBe(false)
    expect(planAllows('basic', 'csv_export')).toBe(false)

    expect(planAllows('pro', 'agent_progress')).toBe(true)
    expect(planAllows('pro', 'agent_competitors')).toBe(false)
    expect(planAllows('pro', 'csv_export')).toBe(false)

    expect(planAllows('enterprise', 'agent_competitors')).toBe(true)
    expect(planAllows('enterprise', 'csv_export')).toBe(true)
  })
})
