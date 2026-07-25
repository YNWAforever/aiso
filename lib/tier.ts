import {
  PLAN_CATALOG,
  getPlanDefinition,
  type PlanFeatures,
  type PlanId,
} from '@/lib/plans/catalog'

export type EffectivePlan = PlanId
export type EntitlementSource = 'free' | 'paid' | 'trial' | 'expired-trial' | 'past_due' | 'cancelled'

export type CommercialAccount = {
  plan?: unknown
  status?: unknown
  stripe_subscription_id?: unknown
  trial_ends_at?: unknown
} | null | undefined

export type CommercialEntitlement = {
  plan: EffectivePlan
  source: EntitlementSource
  features: PlanFeatures
  monthlyScanLimit: number | null
}

const PAID_PLANS = new Set<EffectivePlan>(['basic', 'pro', 'enterprise'])

export function getPlanFeatures(plan: string): PlanFeatures {
  return getPlanDefinition(plan).features
}

export function planAllows(plan: string, feature: keyof PlanFeatures): boolean {
  return Boolean(getPlanFeatures(plan)[feature])
}

export function maxBrandsForPlan(plan: string): number {
  return getPlanDefinition(plan).maxBrands
}

function freeEntitlement(
  source: Extract<EntitlementSource, 'free' | 'expired-trial' | 'past_due' | 'cancelled'>,
): CommercialEntitlement {
  return {
    plan: 'free',
    source,
    features: PLAN_CATALOG.free.features,
    monthlyScanLimit: PLAN_CATALOG.free.monthlyScanLimit,
  }
}

function activeEntitlement(
  plan: Exclude<EffectivePlan, 'free'>,
  source: Extract<EntitlementSource, 'paid' | 'trial'>,
): CommercialEntitlement {
  const definition = PLAN_CATALOG[plan]
  return {
    plan,
    source,
    features: definition.features,
    monthlyScanLimit: definition.monthlyScanLimit,
  }
}

export function resolveCommercialEntitlement(
  account: CommercialAccount,
  now: Date = new Date(),
): CommercialEntitlement {
  if (!account) return freeEntitlement('free')
  if (account.status === 'past_due') return freeEntitlement('past_due')
  if (account.status === 'cancelled') return freeEntitlement('cancelled')

  const plan = typeof account.plan === 'string' && PAID_PLANS.has(account.plan as EffectivePlan)
    ? account.plan as Exclude<EffectivePlan, 'free'>
    : null
  if (!plan) return freeEntitlement('free')

  const trialExpiry = typeof account.trial_ends_at === 'string'
    ? new Date(account.trial_ends_at).getTime()
    : Number.NaN
  const trialIsLive = Number.isFinite(trialExpiry) && trialExpiry > now.getTime()
  const hasSubscription = typeof account.stripe_subscription_id === 'string'
    && account.stripe_subscription_id.length > 0

  if (account.status === 'active' && hasSubscription) {
    return activeEntitlement(plan, 'paid')
  }

  if (trialIsLive || (account.status === 'trialing' && hasSubscription)) {
    return activeEntitlement(plan, 'trial')
  }

  return freeEntitlement(
    typeof account.trial_ends_at === 'string' && Number.isFinite(trialExpiry)
      ? 'expired-trial'
      : 'free',
  )
}
