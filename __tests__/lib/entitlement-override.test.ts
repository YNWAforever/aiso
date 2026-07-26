import { describe, it, expect } from 'vitest'
import { resolveCommercialEntitlement } from '@/lib/tier'

const NOW = new Date('2026-07-26T00:00:00Z')
const FUTURE = '2026-12-31T00:00:00Z'
const PAST = '2026-01-01T00:00:00Z'

// A comped account: no Stripe subscription at all. This is the case that fails
// without the override branch, because the paid path requires has_subscription.
const COMPED = {
  plan: 'basic', status: 'active', stripe_subscription_id: null, trial_ends_at: null,
  override_plan: 'enterprise', override_expires_at: null,
}

describe('resolveCommercialEntitlement — admin override', () => {
  it('grants the override plan to an account with no Stripe subscription', () => {
    const result = resolveCommercialEntitlement(COMPED, NOW)
    expect(result.plan).toBe('enterprise')
    expect(result.source).toBe('override')
    expect(result.features.max_brands).toBe(10)
  })

  it('beats the Stripe-derived plan on a paying account', () => {
    const result = resolveCommercialEntitlement({
      plan: 'basic', status: 'active', stripe_subscription_id: 'sub_1',
      trial_ends_at: null, override_plan: 'pro', override_expires_at: FUTURE,
    }, NOW)
    expect(result.plan).toBe('pro')
    expect(result.source).toBe('override')
  })

  it('treats a null expiry as permanent', () => {
    const result = resolveCommercialEntitlement({ ...COMPED, override_expires_at: null }, NOW)
    expect(result.plan).toBe('enterprise')
  })

  it('ignores an expired override and falls back to Stripe state', () => {
    const result = resolveCommercialEntitlement({
      plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1',
      trial_ends_at: null, override_plan: 'enterprise', override_expires_at: PAST,
    }, NOW)
    expect(result.plan).toBe('pro')
    expect(result.source).toBe('paid')
  })

  it('supports a downgrade comp to free', () => {
    const result = resolveCommercialEntitlement({
      plan: 'enterprise', status: 'active', stripe_subscription_id: 'sub_1',
      trial_ends_at: null, override_plan: 'free', override_expires_at: null,
    }, NOW)
    expect(result.plan).toBe('free')
    expect(result.source).toBe('override')
    expect(result.features.max_brands).toBe(1)
  })

  it('rescues an account whose Stripe state is malformed', () => {
    // past_due would normally force free; a live comp overrides that.
    const result = resolveCommercialEntitlement({
      plan: 'basic', status: 'past_due', stripe_subscription_id: null,
      trial_ends_at: null, override_plan: 'pro', override_expires_at: null,
    }, NOW)
    expect(result.plan).toBe('pro')
    expect(result.source).toBe('override')
  })

  it('ignores an unknown override plan', () => {
    const result = resolveCommercialEntitlement({
      plan: 'basic', status: 'active', stripe_subscription_id: 'sub_1',
      trial_ends_at: null, override_plan: 'platinum', override_expires_at: null,
    }, NOW)
    expect(result.plan).toBe('basic')
    expect(result.source).toBe('paid')
  })

  it('accepts a Date expiry, as returned by the Neon driver for timestamptz', () => {
    const result = resolveCommercialEntitlement(
      { ...COMPED, override_expires_at: new Date(FUTURE) }, NOW,
    )
    expect(result.plan).toBe('enterprise')
  })

  it('leaves accounts without an override unchanged', () => {
    const result = resolveCommercialEntitlement({
      plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1', trial_ends_at: null,
    }, NOW)
    expect(result.plan).toBe('pro')
    expect(result.source).toBe('paid')
  })
})
