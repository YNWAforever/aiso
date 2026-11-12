import { describe, expect, it } from 'vitest'
import { buildTodayView, todayHref } from '@/lib/view-models/today'
import type { WorkspaceHome } from '@/lib/view-models/workspace-home'

type Overrides = {
  nextStep?: WorkspaceHome['nextStep']
  priorities?: Partial<WorkspaceHome['priorities']>
  health?: WorkspaceHome['siteHealth']
  visibility?: WorkspaceHome['visibility']
  gettingStarted?: WorkspaceHome['gettingStarted']
  monthlyReport?: WorkspaceHome['monthlyReport']
}

function home(overrides: Overrides = {}): WorkspaceHome {
  return {
    client: { id: 'c1', brand_name: 'Example', domain: 'example.com' },
    priorities: {
      state: 'ready', priorities: [], primaryAction: null, needsEvidence: [], observedFindings: 0,
      ...overrides.priorities,
    },
    nextStep: overrides.nextStep,
    siteHealth: overrides.health ?? { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
    history: { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
    visibility: overrides.visibility ?? { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
    recommendations: { state: 'empty', data: null, observedAt: null, freshness: 'unknown', generated: true },
    monthlyReport: overrides.monthlyReport ?? null,
    gettingStarted: overrides.gettingStarted ?? null,
  } as WorkspaceHome
}

const health: WorkspaceHome['siteHealth'] = { state: 'ready', observedAt: '2026-11-01T00:00:00Z', freshness: 'unknown', data: { scanId: 's1', domain: 'example.com', score: 66, grade: 'C', pillarScores: null } }
const visibility: WorkspaceHome['visibility'] = { state: 'ready', observedAt: '2026-11-02T00:00:00Z', freshness: 'unknown', data: { sovScore: 32.44, brandMentions: 3, totalQueries: 10, platformCount: 2 } as NonNullable<WorkspaceHome['visibility']['data']> }
const fixPriority = { checkKey: 'c3_bot_access', bucket: 'core', assessment: 'fail', pointsAtStake: 6 } as unknown as NonNullable<WorkspaceHome['priorities']['primaryAction']>

describe('buildTodayView', () => {
  it('recommends the top observed fix when the monitor next step is hidden, linking to results', () => {
    const view = buildTodayView(home({ nextStep: { kind: 'confirm_prompts', href: '/en/dashboard/c1/prompts', labelKey: 'configure' }, priorities: { primaryAction: fixPriority }, health }), { lang: 'en' })
    expect(view.action).toEqual({ kind: 'fix', href: '/en/dashboard/c1?step=results&scanId=s1', checkKey: 'c3_bot_access', points: 6 })
    expect(view.illustration).toBe('fixes')
  })

  it('maps a monitoring next step onto What AI says when there is no fix', () => {
    const view = buildTodayView(home({ nextStep: { kind: 'review_run', href: '/en/dashboard/c1/observations', labelKey: 'review', reasonKey: 'no_models' }, health }), { lang: 'en' })
    expect(view.action).toMatchObject({ kind: 'next', href: '/en/dashboard/c1?step=monitor' })
  })

  it('keeps whatever the workspace projects for an ordinary next step', () => {
    const view = buildTodayView(home({ nextStep: { kind: 'review_opportunity', href: '/en/dashboard/c1/opportunities', labelKey: 'opportunities' } }), { lang: 'en' })
    expect(view.action).toEqual({ kind: 'next', href: '/en/dashboard/c1/opportunities', labelKey: 'opportunities' })
  })

  it('offers a scan when there is nothing to action', () => {
    const view = buildTodayView(home(), { lang: 'en' })
    expect(view.action).toEqual({ kind: 'none', href: '/en/dashboard/c1?step=scan' })
  })

  it('renders at most three metrics with honest states', () => {
    const view = buildTodayView(home({ visibility, health, monthlyReport: { month: '2026-11', status: 'draft', versionNumber: 2 } }), { lang: 'en', client_reports_online: true })
    expect(view.metrics.map(m => m.key)).toEqual(['visibility', 'score', 'report'])
    expect(view.metrics[0]).toMatchObject({ value: '32.4%', state: 'ready', href: '/en/dashboard/c1?step=monitor' })
    expect(view.metrics[1]).toMatchObject({ value: '66', state: 'ready', href: '/en/dashboard/c1?step=results&scanId=s1' })
    expect(view.metrics[2]).toMatchObject({ value: '2026-11', state: 'ready' })
  })

  it('never invents a number for a failed or missing read', () => {
    const failed = buildTodayView(home({
      health: { state: 'error', data: null, observedAt: null, freshness: 'unknown' },
      visibility: { state: 'error', data: null, observedAt: null, freshness: 'unknown' },
    }), { lang: 'en' })
    expect(failed.metrics[0]).toMatchObject({ value: null, state: 'unknown' })
    expect(failed.metrics[1]).toMatchObject({ value: null, state: 'unknown' })

    const locked = buildTodayView(home({ visibility }), { lang: 'en', client_reports_online: false })
    expect(locked.metrics[2]).toMatchObject({ value: null, state: 'locked' })
  })

  it('counts the unfinished setup steps that remain', () => {
    const view = buildTodayView(home({ gettingStarted: { done: 1, steps: [{ key: 'brand', state: 'done' }, { key: 'scan', state: 'current' }, { key: 'fixes', state: 'todo' }, { key: 'questions', state: 'todo' }] } }), { lang: 'en' })
    expect(view.setup).toEqual({ remaining: 3, currentKey: 'scan' })
  })
})

describe('todayHref', () => {
  it('maps hidden Monitor targets onto the visible What AI says tab', () => {
    for (const href of ['/en/dashboard/c1/prompts', '/en/dashboard/c1/observations', '/en/dashboard/c1?step=monitor&scanId=s1']) {
      expect(todayHref(href, '/en/dashboard/c1')).toBe('/en/dashboard/c1?step=monitor')
    }
  })

  it('leaves every other href alone', () => {
    expect(todayHref('/en/dashboard/c1?step=scan', '/en/dashboard/c1')).toBe('/en/dashboard/c1?step=scan')
    expect(todayHref('/en/dashboard/c1/opportunities', '/en/dashboard/c1')).toBe('/en/dashboard/c1/opportunities')
  })
})
