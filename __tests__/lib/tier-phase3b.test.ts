import { getPlanFeatures, maxBrandsForPlan } from '@/lib/tier'

test('pro plan allows 3 brands', () => {
  expect(getPlanFeatures('pro').max_brands).toBe(3)
})

test('basic plan allows 1 brand', () => {
  expect(getPlanFeatures('basic').max_brands).toBe(1)
})

test('maxBrandsForPlan returns correct limits', () => {
  expect(maxBrandsForPlan('basic')).toBe(1)
  expect(maxBrandsForPlan('pro')).toBe(3)
  expect(maxBrandsForPlan('enterprise')).toBe(10)
})
