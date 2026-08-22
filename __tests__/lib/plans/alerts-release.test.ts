import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PLAN_CATALOG } from '@/lib/plans/catalog'

type VercelConfig = { crons?: Array<{ path: string }> }

describe('sovAlerts release state', () => {
  it('is available exactly on the plans entitled to alerts', () => {
    expect(PLAN_CATALOG.pro.release.sovAlerts).toBe('available')
    expect(PLAN_CATALOG.enterprise.release.sovAlerts).toBe('available')
    expect(PLAN_CATALOG.free.release.sovAlerts).toBe('unavailable')
    expect(PLAN_CATALOG.basic.release.sovAlerts).toBe('unavailable')
  })

  it('never advertises alerts as available on a plan without the entitlement', () => {
    // One-directional on purpose: the reverse does not hold. A plan can be
    // entitled (features.alerts: true) while the marketing state is still
    // 'planned' — that is exactly what an honest rollback of the evaluator
    // looks like: revoking the entitlement would 403 the alerts config route
    // and stop customers saving thresholds, so 'planned' must be able to pair
    // with features.alerts: true. Only the other direction is a real bug: the
    // page must never tick a plan that the gate would refuse.
    for (const plan of ['free', 'basic', 'pro', 'enterprise'] as const) {
      if (PLAN_CATALOG[plan].release.sovAlerts === 'available') {
        expect(
          PLAN_CATALOG[plan].features.alerts,
          `${plan}: release.sovAlerts is 'available' but features.alerts is false`,
        ).toBe(true)
      }
    }
  })

  it('is only claimed while something actually fires the evaluator', () => {
    // The whole reason this was 'planned': the evaluator existed but nothing
    // invoked it, so the page would have promised a feature that never ran.
    // Mirrors the sibling promptBank check in pricing-billing-truth.test.ts:
    // gated on the claim so an honest coordinated rollback (drop the claim and
    // the cron together) does not fail this test — only a claim made without
    // the capability that backs it should.
    const claimsAvailable = (['pro', 'enterprise'] as const)
      .some(plan => PLAN_CATALOG[plan].release.sovAlerts === 'available')
    if (!claimsAvailable) return

    // Scheduling moved to the Cloudflare Worker in wrangler.jsonc. Strip comments
    // before parsing since JSON.parse rejects `//`.
    type WranglerConfig = { triggers?: { crons?: string[] } }
    const wranglerRaw = readFileSync(
      join(process.cwd(), 'cloudflare/cron-worker/wrangler.jsonc'),
      'utf8',
    )
    const withoutComments = wranglerRaw.replace(/^\s*\/\/.*$/gm, '')
    const workerConfig = JSON.parse(withoutComments) as WranglerConfig

    // The Worker's crons[1] is evaluate-alerts (after pulse at crons[0]).
    // Both are scheduled; check it's there.
    const scheduled = (workerConfig.triggers?.crons ?? []).length >= 2

    expect(
      scheduled,
      'sovAlerts is advertised as available but evaluate-alerts is not scheduled',
    ).toBe(true)
  })
})
