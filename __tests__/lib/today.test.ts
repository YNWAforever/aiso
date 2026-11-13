import { describe, expect, it } from 'vitest'
import { buildTodayView } from '@/lib/view-models/today'
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
  it('retains the existing top observed website-fix priority ahead of monitoring', () => {
    const view = buildTodayView(home({ nextStep: { kind: 'confirm_prompts', href: '/en/dashboard/c1/prompts', labelKey: 'configure' }, priorities: { primaryAction: fixPriority }, health }), { lang: 'en' })
    expect(view.action).toEqual({ kind: 'fix', href: '/en/dashboard/c1?step=results&scanId=s1', checkKey: 'c3_bot_access', points: 6 })
    expect(view.illustration).toBe('fixes')
  })

  it('preserves the monitoring action and reason when there is no fix', () => {
    const view = buildTodayView(home({ nextStep: { kind: 'review_run', href: '/en/dashboard/c1/observations', labelKey: 'review', reasonKey: 'no_models' }, health }), { lang: 'en' })
    expect(view.action).toEqual({ kind: 'next', href: '/en/dashboard/c1/observations', labelKey: 'review', reasonKey: 'no_models' })
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

describe('Today semantic next steps', () => {
  const cases: NonNullable<WorkspaceHome['nextStep']>[] = [
    { kind: 'confirm_prompts', labelKey: 'configure', href: '/__locale__/dashboard/c1/prompts' },
    { kind: 'start_run', labelKey: 'start', href: '/__locale__/dashboard/c1?step=monitor#first-monitoring' },
    { kind: 'monitoring_status', labelKey: 'status', reasonKey: 'paused', href: '/__locale__/dashboard/c1?step=monitor#first-monitoring' },
    { kind: 'monitoring_status', labelKey: 'status', reasonKey: 'unknown', href: '/__locale__/dashboard/c1?step=monitor#first-monitoring' },
    { kind: 'review_run', labelKey: 'repair', href: '/__locale__/dashboard/c1/observations?run=saved&week=2026-11-09&result=incomplete#run-status' },
    { kind: 'review_run', labelKey: 'review', href: '/__locale__/dashboard/c1/observations?run=saved#run-status' },
    { kind: 'review_results', labelKey: 'results', href: '/__locale__/dashboard/c1/observations' },
    { kind: 'review_work', labelKey: 'work', href: '/__locale__/dashboard/c1/opportunities?draft=saved' },
  ]
  it.each(['en', 'zh-HK'])('normalizes only the locale prefix and keeps exact scope in %s', lang => {
    for (const nextStep of cases) {
      const view = buildTodayView(home({ nextStep }), { lang })
      const { href, labelKey, reasonKey } = nextStep
      expect(view.action).toEqual({ kind: 'next', href: href.replace('/__locale__/', `/${lang}/`), labelKey, ...(reasonKey ? { reasonKey } : {}) })
      expect(JSON.stringify(view.action)).not.toContain('__locale__')
    }
  })
  it('does not replace a scoped saved-run or saved-work link with an unrelated website fix', () => {
    const monitoring = buildTodayView(home({ nextStep: cases[4], priorities: { primaryAction: fixPriority }, health }), { lang: 'en' })
    expect(monitoring.action).toMatchObject({ kind: 'next', labelKey: 'repair', href: '/en/dashboard/c1/observations?run=saved&week=2026-11-09&result=incomplete#run-status' })
    const work = buildTodayView(home({ nextStep: cases[7], priorities: { primaryAction: fixPriority }, health }), { lang: 'en' })
    expect(work.action).toMatchObject({ kind: 'next', labelKey: 'work', href: '/en/dashboard/c1/opportunities?draft=saved' })
  })
})
