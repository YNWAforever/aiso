import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommercialAccount } from '@/lib/tier'

const state = vi.hoisted(() => ({ calls: [] as { text: string; values: unknown[] }[], missing: false, failed: '', selectedMissing: false, dateRows: false, scanResults: {} as Record<string, unknown>, pulse: [] as Record<string, unknown>[], agents: [{ platform: 'gemini', recommendation: 'Draft', created_at: '2026-09-01' }, { platform: 'gpt4o', recommendation: 'Paid draft', created_at: '2026-09-01' }] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?')
  state.calls.push({ text, values })
  if (state.failed && text.includes(state.failed)) throw new Error('Database incident')
  if (text.includes('from clients') && !text.includes('join')) return state.missing || !values.includes('account-a') || !values.includes('client-a') ? [] : [{ id: 'client-a', brand_name: 'Acme', domain: 'example.com', industry: 'technology', status: 'active' }]
  if (text.includes('agent_')) return state.agents
  if (text.includes('with recent_weeks')) {
    // Emulate the SQL window over 45 weeks: ascending-before-limit would lose the latest.
    const newestFirst = /order by [\w.]*scan_week desc/.test(text)
    return newestFirst ? state.pulse.slice(-40) : state.pulse.slice(0, 40)
  }
  if (text.includes('from pulse_metrics')) return []
  if (text.includes('select id, domain')) return [{ id: 'scan-a', domain: 'example.com', score: state.dateRows ? '30' : 30, grade: 'F', created_at: state.dateRows ? new Date('2026-09-01T00:00:00Z') : '2026-09-01' }]
  if (text.includes('from scans')) return state.selectedMissing ? [] : [{ id: 'scan-a', domain: 'example.com', score: state.dateRows ? '30' : 30, grade: 'F', created_at: state.dateRows ? new Date('2026-09-01T00:00:00Z') : '2026-09-01', results: state.scanResults, agent_status: 'complete' }]
  throw new Error('Unexpected query')
} }))

import { loadOwnedWorkspace, workspaceOverview } from '@/lib/workspace/load-owned-workspace'
import { buildWorkspaceHome } from '@/lib/view-models/workspace-home'
const paid: CommercialAccount = { plan: 'enterprise', status: 'active', stripe_subscription_id: 'sub' }
const load = (account: CommercialAccount = paid, scanId?: string) => loadOwnedWorkspace({ clientId: 'client-a', profile: { account_id: 'account-a', accounts: account }, scanId })
const pulseRow = (week: string, total: unknown = 2, successful: unknown = 2) => ({ scan_week: week, platform: null, total_queries: total, brand_mentions: 0, sov_score: 0, successful_queries: successful, observed_queries: 2, observed_brand_mentions: 0, successful_platform_count: 1 })

beforeEach(() => { state.calls = []; state.missing = false; state.failed = ''; state.selectedMissing = false; state.dateRows = false; state.scanResults = {}; state.pulse = [] })

describe('owned workspace loader', () => {
  it('binds ownership first and denies an actual mismatching account before other reads', async () => {
    expect(await loadOwnedWorkspace({ clientId: 'client-a', profile: { account_id: 'other-account', accounts: paid } })).toBeNull()
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0].values).toEqual(['client-a', 'other-account'])
  })
  it('binds every dependent read to both tenant and client and never writes', async () => {
    await load()
    for (const call of state.calls) {
      expect(call.values).toContain('client-a'); expect(call.values).toContain('account-a')
      expect(call.text).toContain('account_id')
      expect(call.text).not.toMatch(/\b(insert|update|delete)\b/i)
    }
  })
  it('keeps an explicit missing scan empty and does not query agents or fall back', async () => {
    state.selectedMissing = true
    const home = buildWorkspaceHome((await load(paid, 'foreign-scan'))!)
    expect(home.siteHealth.state).toBe('empty')
    expect(state.calls.some(call => call.values.includes('foreign-scan') && call.values.includes('client-a') && call.values.includes('account-a'))).toBe(true)
    expect(state.calls.some(call => call.text.includes('agent_recommendations'))).toBe(false)
  })
  it('throws for ownership lookup outage, but keeps optional failures distinct', async () => {
    state.failed = 'from clients'
    await expect(load()).rejects.toThrow()
    state.failed = 'with recent_weeks'
    const workspace = (await load())!
    expect(buildWorkspaceHome(workspace).visibility.state).toBe('error')
    expect(buildWorkspaceHome(workspace).siteHealth.state).toBe('ready')
    expect(() => workspaceOverview(workspace)).toThrow()
  })
  it('returns a true latest week after more than 40 historical weeks', async () => {
    state.pulse = Array.from({ length: 45 }, (_, i) => pulseRow(new Date(Date.UTC(2025, 0, 6 + i * 7)).toISOString().slice(0, 10)))
    const home = buildWorkspaceHome((await load())!)
    expect(home.visibility.data?.scanWeek).toBe(state.pulse[44].scan_week)
    expect(home.visibility.data?.sovScore).toBe(0)
    expect(home.visibility.freshness).toBe('unknown')
  })
  it.each([[0, 0], [null, 2], [2, null], [2, 0], [2, 1]])('withholds KPI for unproven denominator %s/%s', async (total, successful) => {
    state.pulse = [pulseRow('2026-09-01', total, successful)]
    expect(buildWorkspaceHome((await load())!).visibility.state).toBe('empty')
  })
  it('requires whitespace-aware raw answers in collection predicates', async () => {
    await load()
    const query = state.calls.find(call => call.text.includes('with recent_weeks'))!.text
    expect(query).toContain("raw_answer ~ '[^[:space:]]'")
  })
  it('rejects a stale aggregate numerator after a same-count retry', async () => {
    state.pulse = [{ ...pulseRow('2026-09-01'), observed_brand_mentions: 1 }]
    expect(buildWorkspaceHome((await load())!).visibility.state).toBe('empty')
  })
  it('does not use an older aggregate when newest week has only platform rows', async () => {
    state.pulse = [pulseRow('2026-08-24'), { ...pulseRow('2026-08-31'), platform: 'gemini-flash' }]
    expect(buildWorkspaceHome((await load())!).visibility.state).toBe('empty')
  })
  it.each([
    [{ plan: 'free' }, false, false, false],
    [{ plan: 'basic', status: 'active', stripe_subscription_id: 'sub' }, true, false, false],
    [{ plan: 'pro', status: 'active', stripe_subscription_id: 'sub' }, true, true, false],
    [paid, true, true, true],
    [{ ...paid, status: 'cancelled' }, false, false, false],
    [{ ...paid, status: 'past_due' }, false, false, false],
    [{ plan: 'pro', trial_ends_at: '2999-01-01' }, true, true, false],
    [{ plan: 'pro', trial_ends_at: '2000-01-01' }, false, false, false],
    [{ ...paid, status: 'cancelled', override_plan: 'basic' }, true, false, false],
    [{ ...paid, status: 'cancelled', override_plan: 'basic', override_expires_at: '2000-01-01' }, false, false, false],
    [{ plan: 'pro', status: 'trialing', stripe_subscription_id: 'sub' }, true, true, false],
    [{ plan: 'unknown', status: 'active', stripe_subscription_id: 'sub' }, false, false, false],
  ] as const)('projects real entitlement %j before reading paid arrays', async (account, recs, progress, competitors) => {
    const workspace = (await load(account))!
    const dto = workspaceOverview(workspace)
    for (const [table, permitted] of [['agent_recommendations', recs], ['agent_progress', progress], ['agent_competitors', competitors]] as const) expect(state.calls.some(call => call.text.includes(table))).toBe(permitted)
    if (!recs) { expect(dto.recommendations).toEqual([]); expect(buildWorkspaceHome(workspace).recommendations.state).toBe('locked') }
    if (!progress) expect(dto.progress).toEqual([])
    if (!competitors) expect(dto.competitors).toEqual([])
    if (recs && (account.plan === 'basic' || 'override_plan' in account)) expect(dto.recommendations.map(row => row.platform)).toEqual(['gemini'])
  })
  it('normalizes driver Date timestamps and numeric scores without changing stored diagnostics', async () => {
    state.dateRows = true
    const home = buildWorkspaceHome((await load())!)
    expect(home.siteHealth.observedAt).toBe('2026-09-01T00:00:00.000Z')
    expect(home.siteHealth.data?.score).toBe(30)
    expect(home.history.data?.[0].created_at).toBe('2026-09-01T00:00:00.000Z')
    expect(home.history.data?.[0].score).toBe(30)
  })
  it('preserves permitted progress and competitor platform vocabularies', async () => {
    const original = state.agents
    state.agents = [{ platform: 'openai', recommendation: 'Draft', created_at: '2026-09-01' }]
    try {
      const dto = workspaceOverview((await load())!)
      expect(dto.progress).toHaveLength(1)
      expect(dto.competitors).toHaveLength(1)
      expect(dto.recommendations).toHaveLength(0)
    } finally { state.agents = original }
  })
  it('preserves the exact valid stored historical diagnostic snapshot', async () => {
    const pillar = { score: 42, earned: 21, maximum: 50, coverage: 1, checks: 11, covered: 11, passing: 5, warnings: 2, failing: 4 }
    const stored = { methodologyVersion: '2026-08-26.v1', seo: pillar, aeo: pillar, geo: pillar }
    state.scanResults = { pillarScores: stored }
    expect(buildWorkspaceHome((await load())!).siteHealth.data?.pillarScores).toBe(stored)
  })
  it('emits no synthetic diagnostic snapshot and marks recommendations generated', async () => {
    const home = buildWorkspaceHome((await load())!)
    expect(home.siteHealth.data?.pillarScores).toBeNull()
    expect(home.recommendations.generated).toBe(true)
    expect(home.siteHealth.observedAt).toBe('2026-09-01')
  })
})
