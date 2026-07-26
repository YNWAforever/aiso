import { describe, it, expect } from 'vitest'
import { resolveCommercialEntitlement } from '@/lib/tier'

// The `accounts` timestamps are all `timestamptz`, and the Neon driver returns
// those as a JS `Date` — verified against the live database. `getProfile()` in
// lib/auth.ts passes the raw row value straight into the account object and the
// whole thing is cast `as unknown as ProfileWithAccount`, so the compiler cannot
// catch a Date/string mismatch here. These tests pin the coercion instead.
//
// The regression these guard: resolveCommercialEntitlement used to gate the
// trial branch on `typeof account.trial_ends_at === 'string'`, so a Date expiry
// yielded NaN, `trialIsLive` was permanently false, and a live-trial account
// with no Stripe subscription silently resolved to `free`.

const NOW = new Date('2026-07-26T00:00:00Z')
const FUTURE = '2026-12-31T00:00:00Z'
const PAST = '2026-01-01T00:00:00Z'

// A trial-only account: on a plan, no Stripe subscription at all. This is the
// shape that resolved to `free` before the fix.
const TRIAL_ONLY = {
  plan: 'pro',
  status: 'trialing',
  stripe_subscription_id: null,
}

describe('resolveCommercialEntitlement — timestamp coercion', () => {
  it('honours a live trial whose expiry is a Date, as Neon returns it', () => {
    const result = resolveCommercialEntitlement(
      { ...TRIAL_ONLY, trial_ends_at: new Date(FUTURE) }, NOW,
    )
    expect(result.plan).toBe('pro')
    expect(result.source).toBe('trial')
    expect(result.features.max_brands).toBe(3)
  })

  it('reports an expired Date trial as expired-trial, not free', () => {
    const result = resolveCommercialEntitlement(
      { ...TRIAL_ONLY, trial_ends_at: new Date(PAST) }, NOW,
    )
    expect(result.plan).toBe('free')
    expect(result.source).toBe('expired-trial')
  })

  it('still honours a live trial whose expiry is an ISO string', () => {
    const result = resolveCommercialEntitlement(
      { ...TRIAL_ONLY, trial_ends_at: FUTURE }, NOW,
    )
    expect(result.plan).toBe('pro')
    expect(result.source).toBe('trial')
  })

  it('still reports an expired string trial as expired-trial', () => {
    const result = resolveCommercialEntitlement(
      { ...TRIAL_ONLY, trial_ends_at: PAST }, NOW,
    )
    expect(result.plan).toBe('free')
    expect(result.source).toBe('expired-trial')
  })

  it('treats a Date expiry and the equivalent string identically', () => {
    const fromDate = resolveCommercialEntitlement(
      { ...TRIAL_ONLY, trial_ends_at: new Date(FUTURE) }, NOW,
    )
    const fromString = resolveCommercialEntitlement(
      { ...TRIAL_ONLY, trial_ends_at: FUTURE }, NOW,
    )
    expect(fromDate).toEqual(fromString)
  })

  it('distinguishes never-trialled from expired-trial', () => {
    const result = resolveCommercialEntitlement(
      { ...TRIAL_ONLY, trial_ends_at: null }, NOW,
    )
    expect(result.plan).toBe('free')
    expect(result.source).toBe('free')
  })

  it('fails closed on an Invalid Date rather than granting the trial', () => {
    const result = resolveCommercialEntitlement(
      { ...TRIAL_ONLY, trial_ends_at: new Date('nonsense') }, NOW,
    )
    expect(result.plan).toBe('free')
    expect(result.source).toBe('free')
  })

  it('fails closed on a numeric epoch expiry', () => {
    const result = resolveCommercialEntitlement(
      { ...TRIAL_ONLY, trial_ends_at: Date.parse(FUTURE) }, NOW,
    )
    expect(result.plan).toBe('free')
    expect(result.source).toBe('free')
  })

  it('fails closed on an unparseable expiry string', () => {
    const result = resolveCommercialEntitlement(
      { ...TRIAL_ONLY, trial_ends_at: 'not-a-date' }, NOW,
    )
    expect(result.plan).toBe('free')
    expect(result.source).toBe('free')
  })

  it('treats the exact expiry instant as not live, matching the override branch', () => {
    const result = resolveCommercialEntitlement(
      { ...TRIAL_ONLY, trial_ends_at: new Date(NOW) }, NOW,
    )
    expect(result.source).toBe('expired-trial')
  })

  it('lets a paid subscription win over an expired Date trial', () => {
    const result = resolveCommercialEntitlement({
      plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1',
      trial_ends_at: new Date(PAST),
    }, NOW)
    expect(result.plan).toBe('pro')
    expect(result.source).toBe('paid')
  })

  it('lets a live admin override win over a live Date trial', () => {
    const result = resolveCommercialEntitlement({
      ...TRIAL_ONLY,
      trial_ends_at: new Date(FUTURE),
      override_plan: 'enterprise',
      override_expires_at: null,
    }, NOW)
    expect(result.plan).toBe('enterprise')
    expect(result.source).toBe('override')
  })
})
