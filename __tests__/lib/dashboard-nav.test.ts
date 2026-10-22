import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MONITOR_VISIBLE, buildDashboardNav, locateDashboard } from '@/lib/dashboard-nav'

const PAGE = readFileSync(join(process.cwd(), 'app/[lang]/dashboard/[clientId]/page.tsx'), 'utf8')
const HOME = readFileSync(join(process.cwd(), 'components/dashboard/WorkspaceHome.tsx'), 'utf8')
const features = { agent_recs: true, edit_prompts: true }

describe('dashboard navigation model', () => {
  it('has the five sections, with Monitor hidden until Pulse is scheduled', () => {
    expect(MONITOR_VISIBLE).toBe(false)
    expect(buildDashboardNav({ lang: 'en', clientId: 'c1', features }).map(s => s.key)).toEqual(['overview', 'scan', 'reports', 'settings'])
  })

  it('builds every link against the brand in the route', () => {
    const nav = buildDashboardNav({ lang: 'zh-HK', clientId: 'c1', features })
    for (const href of nav.flatMap(s => [s.href, ...s.items.map(i => i.href)])) {
      expect(href.startsWith('/zh-HK/dashboard/c1') || href === '/zh-HK/dashboard/settings', href).toBe(true)
    }
    expect(nav.find(s => s.key === 'scan')!.items.map(i => i.key)).toEqual(['scan', 'results', 'improve', 'opportunities', 'tasks'])
  })

  it('without a brand, sends brand-only sections to the brand list instead of blocking them', () => {
    const nav = buildDashboardNav({ lang: 'en', clientId: null, features })
    expect(nav.find(s => s.key === 'overview')!.href).toBe('/en/dashboard')
    for (const key of ['scan', 'reports'] as const) {
      const section = nav.find(s => s.key === key)!
      expect(section.href).toBe('/en/dashboard#portfolio-brands')
      expect(section.descKey).toBe('select_brand_first')
    }
    expect(nav.find(s => s.key === 'settings')!.href).toBe('/en/dashboard/settings')
  })

  it('marks a plan limit with a lock but never removes the link', () => {
    const nav = buildDashboardNav({ lang: 'en', clientId: 'c1', features: { agent_recs: false, edit_prompts: false } })
    const fixes = nav.find(s => s.key === 'scan')!.items.find(i => i.key === 'improve')!
    expect(fixes.locked).toBe(true)
    expect(fixes.href).toBe('/en/dashboard/c1?step=improve')
  })

  it('leaves no rendered step unreachable except Monitor, which is hidden on purpose', () => {
    // The 7b0cb9d regression: a step the page renders but nothing links to.
    // Every step is reachable from the sidebar, or from Overview (roi) — except
    // monitor while MONITOR_VISIBLE is false.
    const rendered = new Set([...PAGE.matchAll(/step === '(\w+)'/g)].map(m => m[1]))
    const nav = buildDashboardNav({ lang: 'en', clientId: 'c1', features })
    const linked = new Set(nav.flatMap(s => [s.href, ...s.items.map(i => i.href)]).map(href => /\?step=(\w+)/.exec(href)?.[1]).filter(Boolean))
    if (/\?step=roi/.test(HOME)) linked.add('roi')
    const unreachable = [...rendered].filter(step => !linked.has(step))
    expect(unreachable).toEqual(MONITOR_VISIBLE ? [] : ['monitor'])
  })

  it.each([
    ['/en/dashboard', null, 'overview', null],
    ['/en/dashboard/settings', null, 'settings', 'account'],
    ['/en/dashboard/c1', null, 'overview', null],
    ['/en/dashboard/c1', 'roi', 'overview', 'roi'],
    ['/en/dashboard/c1', 'results', 'scan', 'results'],
    ['/en/dashboard/c1/tasks', null, 'scan', 'tasks'],
    ['/en/dashboard/c1/work-items/w1/versions', null, 'scan', 'tasks'],
    ['/en/dashboard/c1/result/s1', null, 'scan', 'results'],
    ['/en/dashboard/c1/prompts', null, 'monitor', 'prompts'],
    ['/en/dashboard/c1/reports/new', null, 'reports', 'reports'],
    ['/en/dashboard/c1/sources', null, 'settings', 'sources'],
  ])('locates %s?step=%s in %s / %s', (pathname, step, section, item) => {
    expect(locateDashboard(pathname, step)).toMatchObject({ section, item })
  })
})
