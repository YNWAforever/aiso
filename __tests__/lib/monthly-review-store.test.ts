import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ rows: [] as unknown[][], calls: [] as { text: string; values: unknown[] }[] }))
vi.mock('@/lib/db', () => ({
  db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    h.calls.push({ text: strings.join('?'), values })
    return Promise.resolve(h.rows.shift() ?? [])
  },
}))

import { loadMonthlyReviewTarget, readMonthlyReviews, recordMonthlyReviewDecision } from '@/lib/monthly-report/store'

const slug = 's'.repeat(32)
const versionId = '22222222-2222-4222-8222-222222222222'
const input = { slug, versionId, decision: 'approved' as const, reviewerName: 'Mei', comment: null, tokenHash: 'a'.repeat(64) }

beforeEach(() => { h.rows = []; h.calls = [] })

describe('recordMonthlyReviewDecision', () => {
  it('writes exactly once through the report latest version, not a caller-supplied version', async () => {
    h.rows = [[{ decided_at: '2026-12-05T02:00:00.000Z' }]]
    expect(await recordMonthlyReviewDecision(input)).toEqual({ state: 'recorded', decidedAt: '2026-12-05T02:00:00.000Z' })
    const insert = h.calls[0].text
    expect(insert).toContain("r.kind = 'monthly'")
    expect(insert).toContain('r.latest_version_id')
    expect(insert).toContain('on conflict (report_id, version_id) do nothing')
    expect(h.calls[0].values).toEqual([input.decision, input.reviewerName, input.comment, input.tokenHash, slug, versionId])
  })

  it('reports a replayed decision as already recorded, never as a second write', async () => {
    h.rows = [[], [{ present: 1 }]]
    expect(await recordMonthlyReviewDecision(input)).toEqual({ state: 'already' })
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1].text).toContain('from client_report_reviews')
  })

  it('reports not_found when neither the report nor a recorded decision exists', async () => {
    h.rows = [[], []]
    expect(await recordMonthlyReviewDecision(input)).toEqual({ state: 'not_found' })
  })
})

describe('loadMonthlyReviewTarget', () => {
  it('maps the latest version, month, status and account entitlement fields', async () => {
    h.rows = [[{
      report_id: 'r1', version_id: versionId, account_id: 'acc', client_id: 'client', month: '2026-11-01',
      status: 'draft', public_slug: slug, share_version: 2, version_number: 3, locale: 'zh-HK', snapshot: { a: 1 },
      published_at: null, plan: 'pro', account_status: 'active', stripe_subscription_id: 'sub', trial_ends_at: null,
      override_plan: null, override_expires_at: null,
    }]]
    expect(await loadMonthlyReviewTarget(slug)).toEqual({
      reportId: 'r1', versionId, accountId: 'acc', clientId: 'client', month: '2026-11', status: 'draft',
      publicSlug: slug, shareVersion: 2, versionNumber: 3, locale: 'zh-HK', snapshot: { a: 1 }, publishedAt: null,
      account: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub', trial_ends_at: null, override_plan: null, override_expires_at: null },
    })
    expect(h.calls[0].text).toContain("r.kind = 'monthly'")
    expect(h.calls[0].values).toEqual([slug])
  })

  it('ties dashboard reads to the account and report, newest decision first', async () => {
    h.rows = [[{ version_id: versionId, decision: 'changes_requested', reviewer_name: null, comment: 'Fix it', decided_at: '2026-12-05T02:00:00.000Z', version_number: 2 }]]
    expect(await readMonthlyReviews('acc', 'client', 'r1')).toEqual([{
      versionId, versionNumber: 2, decision: 'changes_requested', reviewerName: null, comment: 'Fix it',
      decidedAt: '2026-12-05T02:00:00.000Z',
    }])
    expect(h.calls[0].text).toContain('r.account_id')
    expect(h.calls[0].text).toContain('r.client_id')
    expect(h.calls[0].values).toEqual(['acc', 'client', 'r1'])
  })
})
