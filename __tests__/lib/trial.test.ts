import { getTrialStatus } from '@/lib/trial'
import type { Account } from '@/lib/types'

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    plan: 'basic',
    status: 'active',
    trial_started_at: null,
    trial_ends_at: null,
    trial_emails_sent: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('getTrialStatus', () => {
  it('returns isTrial=false when trial_ends_at is null', () => {
    const result = getTrialStatus(makeAccount())
    expect(result.isTrial).toBe(false)
    expect(result.isExpired).toBe(false)
    expect(result.daysRemaining).toBe(0)
  })

  it('returns correct daysRemaining for active trial', () => {
    const endsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    const result = getTrialStatus(makeAccount({ trial_ends_at: endsAt }))
    expect(result.isTrial).toBe(true)
    expect(result.isExpired).toBe(false)
    expect(result.daysRemaining).toBe(5)
  })

  it('returns isExpired=true when trial_ends_at is in the past', () => {
    const endsAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const result = getTrialStatus(makeAccount({ trial_ends_at: endsAt }))
    expect(result.isTrial).toBe(true)
    expect(result.isExpired).toBe(true)
    expect(result.daysRemaining).toBe(0)
  })
})
