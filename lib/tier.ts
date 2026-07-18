import type { PlanFeatures } from '@/lib/types'

const FEATURES: Record<string, PlanFeatures> = {
  free: {
    plan: 'free',
    platform_access: [],
    agent_recs: false, agent_progress: false, agent_competitors: false,
    alerts: false, csv_export: false,
    max_brands: 1, history_weeks: 0, edit_prompts: false,
    local_trust_roi: false, local_trust_competitors: false, local_trust_export: false,
  },
  basic: {
    plan: 'basic',
    platform_access: ['gemini'],
    agent_recs: true, agent_progress: false, agent_competitors: false,
    alerts: false, csv_export: false,
    max_brands: 1, history_weeks: 4, edit_prompts: false,
    local_trust_roi: false, local_trust_competitors: false, local_trust_export: false,
  },
  pro: {
    plan: 'pro',
    platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
    agent_recs: true, agent_progress: true, agent_competitors: false,
    alerts: true, csv_export: false,
    max_brands: 3, history_weeks: 26, edit_prompts: true,
    local_trust_roi: true, local_trust_competitors: false, local_trust_export: false,
  },
  enterprise: {
    plan: 'enterprise',
    platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
    agent_recs: true, agent_progress: true, agent_competitors: true,
    alerts: true, csv_export: true,
    max_brands: 10, history_weeks: 999, edit_prompts: true,
    local_trust_roi: true, local_trust_competitors: true, local_trust_export: true,
  },
}

export type EffectivePlan = 'free' | 'basic' | 'pro' | 'enterprise'
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
  return FEATURES[plan] ?? FEATURES.free!
}

export function planAllows(plan: string, feature: keyof PlanFeatures): boolean {
  return Boolean(getPlanFeatures(plan)[feature])
}

export function maxBrandsForPlan(plan: string): number {
  return getPlanFeatures(plan).max_brands
}

function freeEntitlement(
  source: Extract<EntitlementSource, 'free' | 'expired-trial' | 'past_due' | 'cancelled'>,
): CommercialEntitlement {
  return {
    plan: 'free',
    source,
    features: FEATURES.free!,
    monthlyScanLimit: 0,
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
    return {
      plan,
      source: 'paid',
      features: FEATURES[plan]!,
      monthlyScanLimit: plan === 'basic' ? 3 : null,
    }
  }

  if (trialIsLive || (account.status === 'trialing' && hasSubscription)) {
    return {
      plan,
      source: 'trial',
      features: FEATURES[plan]!,
      monthlyScanLimit: plan === 'basic' ? 3 : null,
    }
  }

  return freeEntitlement(
    typeof account.trial_ends_at === 'string' && Number.isFinite(trialExpiry)
      ? 'expired-trial'
      : 'free',
  )
}
