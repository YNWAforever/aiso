import { TIER_FEATURES, maxBrandsForPlan } from '@/lib/tier'

test('pro plan allows 3 brands', () => {
  expect(TIER_FEATURES.pro.maxBrands).toBe(3)
})

test('starter plan allows 1 brand', () => {
  expect(TIER_FEATURES.starter.maxBrands).toBe(1)
})

test('maxBrandsForPlan returns correct limits', () => {
  expect(maxBrandsForPlan('starter')).toBe(1)
  expect(maxBrandsForPlan('pro')).toBe(3)
  expect(maxBrandsForPlan('enterprise')).toBe(10)
})
