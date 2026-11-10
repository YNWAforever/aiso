import { describe, expect, it } from 'vitest'
import { feedForAccount, groupRows, longestConsecutiveRun, replayMonth, resolveFeedEntitlement } from '@/scripts/replay-movement-rule.mjs'
import { resolveCommercialEntitlement } from '@/lib/tier'

/**
 * The Q1 replay's pure half: grouping stored weeks into brand-months, measuring
 * the consecutive-week run that decides whether Q1 can be judged at all, and the
 * rule's verdict per platform. The first production replay (2026-11-09) found no
 * month with four consecutive weeks, so these fixtures are the only place the
 * "ready" path can be exercised until the data exists.
 */
const row = (week: string, platform = 'gpt-4o', sov = 10, answers = 8) =>
  ({ brand_name: 'Brand', client_id: 'client-1', platform, week, sov, answers })

describe('groupRows', () => {
  it('groups by brand-month then platform, keeping each reading', () => {
    const entries = groupRows([
      row('2026-11-02', 'gpt-4o', 10), row('2026-11-09', 'gpt-4o', 11), row('2026-11-02', 'claude-haiku', 5),
      row('2026-10-05', 'gpt-4o', 9),
    ])
    expect(entries).toHaveLength(2)
    expect(entries[0].month).toBe('2026-10')
    expect(entries[1].month).toBe('2026-11')
    expect([...entries[1].platforms.get('gpt-4o')]).toEqual([
      { week: '2026-11-02', sov: 10, answers: 8 }, { week: '2026-11-09', sov: 11, answers: 8 },
    ])
    expect(entries[1].platforms.get('claude-haiku')).toHaveLength(1)
  })
})

describe('longestConsecutiveRun', () => {
  it('counts only weeks exactly seven days apart', () => {
    expect(longestConsecutiveRun([row('2026-10-05'), row('2026-10-12'), row('2026-10-19')])).toBe(3)
    // The 19 Oct week missing: two separate runs of 2.
    expect(longestConsecutiveRun([row('2026-10-05'), row('2026-10-12'), row('2026-10-26'), row('2026-11-02')])).toBe(2)
    expect(longestConsecutiveRun([])).toBe(0)
  })
})

describe('replayMonth', () => {
  const entry = (readings: ReturnType<typeof row>[]) => groupRows(readings)[0]

  it('marks a month ready and reports a direction once four consecutive weeks move up', () => {
    const result = replayMonth(entry([
      row('2026-11-02', 'gpt-4o', 10), row('2026-11-09', 'gpt-4o', 11), row('2026-11-16', 'gpt-4o', 12), row('2026-11-23', 'gpt-4o', 13),
    ]))
    expect(result.readyForQ1).toBe(true)
    expect(result.platforms[0]).toMatchObject({ platform: 'gpt-4o', weeks: 4, longestRun: 4, direction: 'up' })
    expect(result.visibility.state).toBe('recorded')
  })

  it('is not ready while the consecutive run is short, however many readings exist', () => {
    const result = replayMonth(entry([
      row('2026-11-02'), row('2026-11-09'), row('2026-11-16'), row('2026-11-30'),
    ]))
    expect(result.readyForQ1).toBe(false)
    expect(result.platforms[0]).toMatchObject({ direction: null, reason: 'insufficient_weeks' })
  })

  it('uses the month snapshot as the report section opening and closing figures', () => {
    const result = replayMonth(entry([row('2026-11-02'), row('2026-11-09'), row('2026-11-16'), row('2026-11-23')]), [
      { client_id: 'client-1', month: '2026-11', kind: 'opening', platforms: [{ platform: 'gpt-4o', sovScore: 10 }] },
      { client_id: 'client-1', month: '2026-11', kind: 'closing', platforms: [{ platform: 'gpt-4o', sovScore: 14 }] },
    ])
    expect(result.visibility.state === 'recorded' ? result.visibility.platforms[0] : null)
      .toMatchObject({ platform: 'gpt-4o', opening: 10, closing: 14, delta: 4 })
  })
})

/**
 * The feed side of the replay. On 2026-11-10 the only brand with a five-platform
 * prompt bank lost its Pro comp; the replay then said "not enough weeks", which
 * reads as "wait" when it actually meant "no more weeks will ever arrive". The
 * copy of the resolver in the script exists because plain Node cannot resolve
 * the `@/` alias, so these parity cases are what keeps it aligned with
 * lib/tier.ts — the real gate the app uses.
 */
describe('resolveFeedEntitlement', () => {
  const now = new Date('2026-11-11T00:00:00Z')
  const expiredTrial = { plan: 'basic', status: 'active', trial_ends_at: '2026-09-18T02:30:37Z' }
  const accounts = [
    null,
    expiredTrial,
    { plan: 'basic', status: 'active', trial_ends_at: '2026-11-16T10:23:51Z' },
    { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' },
    { plan: 'pro', status: 'active', stripe_subscription_id: null, trial_ends_at: '2026-11-16T10:23:51Z' },
    { plan: 'pro', status: 'trialing', stripe_subscription_id: 'sub_1' },
    { plan: 'pro', status: 'past_due', stripe_subscription_id: 'sub_1' },
    { plan: 'pro', status: 'cancelled', stripe_subscription_id: 'sub_1' },
    { ...expiredTrial, override_plan: 'pro', override_expires_at: '2026-12-05T00:00:00Z' },
    { ...expiredTrial, override_plan: 'pro', override_expires_at: '2026-11-10T00:00:00Z' },
    { ...expiredTrial, override_plan: 'pro', override_expires_at: null },
    { ...expiredTrial, override_plan: 'not-a-plan', override_expires_at: '2026-12-05T00:00:00Z' },
    { plan: 'unknown', status: 'active', trial_ends_at: '2026-11-16T10:23:51Z' },
  ]

  it('matches the app resolver for every account branch', () => {
    for (const account of accounts) {
      const expected = resolveCommercialEntitlement(account, now)
      expect(resolveFeedEntitlement(account, now)).toEqual({ plan: expected.plan, source: expected.source })
    }
  })

  it('reports the platforms a live comp can still collect, and when it lapses', () => {
    expect(feedForAccount({ ...expiredTrial, override_plan: 'pro', override_expires_at: '2026-12-05T00:00:00Z' }, now))
      .toEqual({ plan: 'pro', source: 'override', platforms: 5, endsAt: '2026-12-05T00:00:00.000Z' })
  })

  it('reports zero platforms once the trial has expired, so the warning can fire', () => {
    expect(feedForAccount(expiredTrial, now))
      .toEqual({ plan: 'free', source: 'expired-trial', platforms: 0, endsAt: null })
  })

  it('reports the single gemini platform a basic trial grants', () => {
    expect(feedForAccount({ plan: 'basic', status: 'active', trial_ends_at: '2026-11-16T10:23:51Z' }, now))
      .toMatchObject({ plan: 'basic', source: 'trial', platforms: 1, endsAt: '2026-11-16T10:23:51.000Z' })
  })
})
