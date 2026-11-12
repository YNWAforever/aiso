import { describe, expect, it } from 'vitest'
import { brandHomeHref, buildDashboardNav, locateDashboard } from '@/lib/dashboard-nav'

const features = { agent_recs: true, edit_prompts: false }
const base = { lang: 'en', clientId: 'c1', features, smeCopilot: true, conversationStudio: true }

describe('SME copilot IA: destinations', () => {
  it('renders exactly five brand destinations in order', () => {
    const nav = buildDashboardNav(base)
    expect(nav.map(section => section.key)).toEqual(['today', 'chat', 'what_ai_says', 'improve', 'reports'])
    expect(nav.map(section => section.labelKey)).toEqual(['nav_today', 'nav_chat', 'nav_what_ai_says', 'nav_improve', 'nav_reports'])
  })

  it('sends Today to the bare brand URL, never to Studio', () => {
    const nav = buildDashboardNav(base)
    expect(nav.find(section => section.key === 'today')).toMatchObject({ href: '/en/dashboard/c1', needsBrand: false })
    expect(brandHomeHref({ lang: 'en', clientId: 'c1', smeCopilot: true, conversationStudio: true })).toBe('/en/dashboard/c1')
  })

  it('hides Chat when the Studio flag is off for this navigation', () => {
    const nav = buildDashboardNav({ ...base, conversationStudio: false })
    expect(nav.map(section => section.key)).toEqual(['today', 'what_ai_says', 'improve', 'reports'])
  })

  it('keeps every old URL working through tab items', () => {
    const nav = buildDashboardNav(base)
    const hrefs = nav.flatMap(section => [section.href, ...section.items.map(item => item.href)])
    for (const href of [
      '/en/dashboard/c1/studio', '/en/dashboard/c1?step=monitor', '/en/dashboard/c1/observations',
      '/en/dashboard/c1/prompts', '/en/dashboard/c1/competitors', '/en/dashboard/c1/citations',
      '/en/dashboard/c1?step=scan', '/en/dashboard/c1?step=results', '/en/dashboard/c1?step=improve',
      '/en/dashboard/c1/opportunities', '/en/dashboard/c1/tasks',
      '/en/dashboard/c1/reports', '/en/dashboard/c1/month', '/en/dashboard/this-month',
    ]) expect(hrefs, href).toContain(href)
  })

  it('keeps the plan lock on Improve without changing the link', () => {
    const nav = buildDashboardNav({ ...base, features: { ...features, agent_recs: false } })
    const item = nav.find(section => section.key === 'improve')!.items.find(i => i.key === 'improve')!
    expect(item.locked).toBe(true)
    expect(item.href).toBe('/en/dashboard/c1?step=improve')
  })

  it('puts account pages in the avatar menu, not the sidebar', () => {
    const sidebar = buildDashboardNav(base)
    expect(sidebar.some(section => section.key === 'account')).toBe(false)
    const hidden = buildDashboardNav({ ...base, includeHidden: true })
    const account = hidden.find(section => section.key === 'account')!
    expect(account.items.map(item => item.key)).toEqual(['entities', 'sources', 'assets', 'account', 'billing'])
    expect(account.items.find(item => item.key === 'account')!.href).toBe('/en/dashboard/settings')
    expect(account.items.find(item => item.key === 'billing')!.href).toBe('/en/dashboard/billing')
  })

  it('keeps account navigation to Today, Reports and Account', () => {
    const nav = buildDashboardNav({ lang: 'en', features, smeCopilot: true, clientId: null })
    expect(nav.map(section => section.key)).toEqual(['today', 'reports', 'account'])
  })

  it('carries the selected scan into brand tab links only', () => {
    const nav = buildDashboardNav({ ...base, scanId: 's1' })
    expect(nav.find(section => section.key === 'improve')!.items.find(i => i.key === 'scan')!.href).toBe('/en/dashboard/c1?step=scan&scanId=s1')
    expect(nav.find(section => section.key === 'today')!.href).toBe('/en/dashboard/c1')
  })
})

describe('SME copilot IA: location', () => {
  it('maps every brand home alias to Today', () => {
    for (const step of [null, 'home', 'overview']) {
      expect(locateDashboard('/en/dashboard/c1', step, true)).toEqual({ section: 'today', item: null, clientId: 'c1' })
    }
  })

  it('maps the old step pages onto the new destinations', () => {
    expect(locateDashboard('/en/dashboard/c1', 'monitor', true)).toEqual({ section: 'what_ai_says', item: 'monitor', clientId: 'c1' })
    expect(locateDashboard('/en/dashboard/c1', 'scan', true)).toEqual({ section: 'improve', item: 'scan', clientId: 'c1' })
    expect(locateDashboard('/en/dashboard/c1', 'roi', true)).toEqual({ section: 'today', item: 'roi', clientId: 'c1' })
  })

  it('maps segment routes, including the account pages and account-only pages', () => {
    expect(locateDashboard('/en/dashboard/c1/studio', null, true)).toEqual({ section: 'chat', item: 'chat', clientId: 'c1' })
    expect(locateDashboard('/en/dashboard/c1/observations', null, true)).toEqual({ section: 'what_ai_says', item: 'observations', clientId: 'c1' })
    expect(locateDashboard('/en/dashboard/c1/prompts', null, true)).toEqual({ section: 'what_ai_says', item: 'prompts', clientId: 'c1' })
    expect(locateDashboard('/en/dashboard/c1/tasks', null, true)).toEqual({ section: 'improve', item: 'tasks', clientId: 'c1' })
    expect(locateDashboard('/en/dashboard/c1/month', null, true)).toEqual({ section: 'reports', item: 'month', clientId: 'c1' })
    expect(locateDashboard('/en/dashboard/c1/entities', null, true)).toEqual({ section: 'account', item: 'entities', clientId: 'c1' })
    expect(locateDashboard('/en/dashboard/settings', null, true)).toEqual({ section: 'account', item: 'account', clientId: null })
    expect(locateDashboard('/en/dashboard/billing', null, true)).toEqual({ section: 'account', item: 'billing', clientId: null })
    expect(locateDashboard('/en/dashboard/this-month', null, true)).toEqual({ section: 'reports', item: 'this-month', clientId: null })
  })

  it('keeps the legacy mapping untouched when the flag is off', () => {
    expect(locateDashboard('/en/dashboard/c1', 'home')).toEqual({ section: 'overview', item: null, clientId: 'c1' })
    expect(locateDashboard('/en/dashboard/c1/studio', null)).toEqual({ section: 'studio', item: 'studio', clientId: 'c1' })
    expect(locateDashboard('/en/dashboard/c1/month', null)).toEqual({ section: 'reports', item: 'reports', clientId: 'c1' })
  })
})
