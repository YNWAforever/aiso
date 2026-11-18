import { describe, expect, it } from 'vitest'
import { planDisplayName } from '@/lib/format/plan-name'
import { PLAN_IDS } from '@/lib/plans/catalog'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

describe('planDisplayName', () => {
  it('names every plan in both locales, never as its stored id', () => {
    for (const plan of PLAN_IDS) {
      expect(en.planNames[plan]).toBeTruthy()
      expect(zh.planNames[plan]).toBeTruthy()
      expect(planDisplayName(plan, 'en')).toBe(en.planNames[plan])
      expect(planDisplayName(plan, 'zh-HK')).toBe(zh.planNames[plan])
      expect(planDisplayName(plan, 'en')).not.toBe(plan)
    }
  })
  it('matches the pricing page names in zh-HK', () => {
    expect(planDisplayName('pro', 'zh-HK')).toBe(zh.dashboard.plan_pro)
    expect(planDisplayName('enterprise', 'zh-HK')).toBe(zh.dashboard.plan_enterprise)
  })
  it('falls back to Free for no plan and title-cases an unknown id', () => {
    expect(planDisplayName(null, 'en')).toBe('Free')
    expect(planDisplayName('agency', 'en')).toBe('Agency')
  })
})
