import { describe, expect, it } from 'vitest'
import { resolveCommercialEntitlement } from '@/lib/tier'

const NOW = new Date('2026-07-18T12:00:00.000Z')

function account(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'basic',
    status: 'active',
    stripe_subscription_id: null,
    trial_ends_at: null,
    ...overrides,
  }
}

describe('resolveCommercialEntitlement', () => {
  it('resolves a subscriptionless account without a live trial to free', () => {
    const entitlement = resolveCommercialEntitlement(account(), NOW)

    expect(entitlement).toMatchObject({ plan: 'free', source: 'free', monthlyScanLimit: 0 })
    expect(entitlement.features).toMatchObject({
      plan: 'free',
      max_brands: 1,
      agent_recs: false,
      alerts: false,
      local_trust_roi: false,
    })
    expect(entitlement.features.platform_access).toEqual([])
  })

  it.each([
    ['basic', 3],
    ['pro', null],
    ['enterprise', null],
  ] as const)('resolves active paid %s from a Stripe subscription', (plan, monthlyScanLimit) => {
    expect(resolveCommercialEntitlement(account({
      plan,
      stripe_subscription_id: 'sub_paid',
    }), NOW)).toMatchObject({ plan, source: 'paid', monthlyScanLimit })
  })

  it('resolves an unexpired subscriptionless trial to its stored plan', () => {
    expect(resolveCommercialEntitlement(account({
      plan: 'basic',
      trial_ends_at: '2026-07-19T12:00:00.000Z',
    }), NOW)).toMatchObject({ plan: 'basic', source: 'trial', monthlyScanLimit: 3 })
  })

  it('resolves a Stripe-managed trial from trialing status and a subscription id', () => {
    expect(resolveCommercialEntitlement(account({
      plan: 'pro',
      status: 'trialing',
      stripe_subscription_id: 'sub_trial',
      trial_ends_at: null,
    }), NOW)).toMatchObject({ plan: 'pro', source: 'trial', monthlyScanLimit: null })
  })

  it.each(['past_due', 'cancelled'] as const)(
    'fails closed to free for %s accounts even with subscription and future trial data',
    status => {
      expect(resolveCommercialEntitlement(account({
        plan: 'enterprise',
        status,
        stripe_subscription_id: 'sub_stale',
        trial_ends_at: '2026-07-19T12:00:00.000Z',
      }), NOW)).toMatchObject({ plan: 'free', source: status, monthlyScanLimit: 0 })
    },
  )

  it('fails closed to free after a subscriptionless trial expires', () => {
    expect(resolveCommercialEntitlement(account({
      trial_ends_at: '2026-07-18T11:59:59.999Z',
    }), NOW)).toMatchObject({ plan: 'free', source: 'expired-trial', monthlyScanLimit: 0 })
  })

  it('keeps an active paid subscription effective after an onboarding trial date expires', () => {
    expect(resolveCommercialEntitlement(account({
      plan: 'pro',
      stripe_subscription_id: 'sub_paid',
      trial_ends_at: '2026-07-01T00:00:00.000Z',
    }), NOW)).toMatchObject({ plan: 'pro', source: 'paid', monthlyScanLimit: null })
  })

  it('keeps an active paid subscription paid when a stale future trial timestamp remains', () => {
    expect(resolveCommercialEntitlement(account({
      plan: 'pro',
      stripe_subscription_id: 'sub_paid',
      trial_ends_at: '2026-07-19T12:00:00.000Z',
    }), NOW)).toMatchObject({ plan: 'pro', source: 'paid', monthlyScanLimit: null })
  })

  it('fails closed when account data is missing or malformed', () => {
    expect(resolveCommercialEntitlement(null, NOW).plan).toBe('free')
    expect(resolveCommercialEntitlement(account({ plan: 'unexpected' }), NOW).plan).toBe('free')
    expect(resolveCommercialEntitlement(account({ trial_ends_at: 'not-a-date' }), NOW).plan).toBe('free')
  })

  it('derives limits and features from the canonical catalog', () => {
    const enterprise = resolveCommercialEntitlement(account({
      plan: 'enterprise',
      stripe_subscription_id: 'sub_enterprise',
    }), NOW)

    expect(enterprise).toMatchObject({
      plan: 'enterprise',
      monthlyScanLimit: null,
      features: { max_brands: 10, history_weeks: 999 },
    })
  })

  it.each([
    ['free', false],
    ['basic', false],
    ['pro', true],
    ['enterprise', true],
  ] as const)('exposes online client report capability for %s according to the catalog', (plan, expected) => {
    const entitlement = plan === 'free'
      ? resolveCommercialEntitlement(null, NOW)
      : resolveCommercialEntitlement(account({ plan, stripe_subscription_id: 'sub_report' }), NOW)

    expect(entitlement.features.client_reports_online).toBe(expected)
  })
})
