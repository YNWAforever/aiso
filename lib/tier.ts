export const TIER_FEATURES = {
  starter: {
    maxBrands: 1,
    editPrompts: false,
    historyWeeks: 4,
    alerts: false,
  },
  pro: {
    maxBrands: 3,
    editPrompts: true,
    historyWeeks: 26,
    alerts: true,
  },
  enterprise: {
    maxBrands: 10,
    editPrompts: true,
    historyWeeks: 999,
    alerts: true,
  },
} as const

type TierFeatures = typeof TIER_FEATURES.starter
type Plan = keyof typeof TIER_FEATURES

export function planAllows(plan: string, feature: keyof TierFeatures): boolean {
  const tier = TIER_FEATURES[plan as Plan]
  if (!tier) return false
  return Boolean(tier[feature])
}

export function maxBrandsForPlan(plan: string): number {
  const tier = TIER_FEATURES[plan as Plan]
  return tier?.maxBrands ?? 1
}
