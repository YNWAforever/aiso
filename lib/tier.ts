import {
  PLAN_CATALOG,
  PLAN_IDS,
  getPlanDefinition,
  type PlanFeatures,
  type PlanId,
} from '@/lib/plans/catalog'

export type EffectivePlan = PlanId
export type EntitlementSource =
  | 'free' | 'paid' | 'trial' | 'expired-trial' | 'past_due' | 'cancelled' | 'override'

export type CommercialAccount = {
  plan?: unknown
  status?: unknown
  stripe_subscription_id?: unknown
  trial_ends_at?: unknown
  override_plan?: unknown
  override_expires_at?: unknown
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

// Single builder behind freeEntitlement, activeEntitlement, and the override
// branch in resolveCommercialEntitlement. freeEntitlement/activeEntitlement
// keep their own narrower signatures on purpose — that's what stops a call
// like freeEntitlement('paid') or activeEntitlement('free', 'trial') from
// typechecking. The override branch needs the unrestricted form because a
// comp can legitimately be 'free' with source 'override'.
function entitlementFor(plan: EffectivePlan, source: EntitlementSource): CommercialEntitlement {
  const definition = PLAN_CATALOG[plan]
  return {
    plan,
    source,
    features: definition.features,
    monthlyScanLimit: definition.monthlyScanLimit,
  }
}

function freeEntitlement(
  source: Extract<EntitlementSource, 'free' | 'expired-trial' | 'past_due' | 'cancelled'>,
): CommercialEntitlement {
  return entitlementFor('free', source)
}

function activeEntitlement(
  plan: Exclude<EffectivePlan, 'free'>,
  source: Extract<EntitlementSource, 'paid' | 'trial'>,
): CommercialEntitlement {
  return entitlementFor(plan, source)
}

// The catalog's own plan-id list — not a hardcoded copy of it — so this set
// can never drift from PLAN_CATALOG's keys. Deliberately not getPlanDefinition():
// that helper falls back to PLAN_CATALOG.free for an unrecognized id, which
// would silently turn a typo'd override_plan into a *downgrade* comp instead
// of a no-op.
const OVERRIDE_PLANS = new Set<PlanId>(PLAN_IDS)

// Returns the override plan when one is set and unexpired, else null.
// A null expiry means permanent; a malformed expiry voids the whole override
// rather than being treated as permanent, so a bad write fails closed.
function liveOverridePlan(account: NonNullable<CommercialAccount>, now: Date): EffectivePlan | null {
  const plan = typeof account.override_plan === 'string'
    && OVERRIDE_PLANS.has(account.override_plan as EffectivePlan)
    ? account.override_plan as EffectivePlan
    : null
  if (!plan) return null

  const raw = account.override_expires_at
  if (raw === null || raw === undefined) return plan

  const expiry = raw instanceof Date ? raw.getTime()
    : typeof raw === 'string' ? new Date(raw).getTime()
      : Number.NaN
  if (!Number.isFinite(expiry)) return null

  return expiry > now.getTime() ? plan : null
}

export function resolveCommercialEntitlement(
  account: CommercialAccount,
  now: Date = new Date(),
): CommercialEntitlement {
  if (!account) return freeEntitlement('free')

  // Branch 1: a live admin override determines entitlement outright. It runs
  // BEFORE the status checks and before has_subscription, because a comped
  // account has no Stripe subscription and may have broken Stripe state —
  // which is exactly when a comp is needed.
  const overridePlan = liveOverridePlan(account, now)
  if (overridePlan) return entitlementFor(overridePlan, 'override')

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
