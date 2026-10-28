import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const nav = vi.hoisted(() => ({
  params: { lang: 'en' } as { lang: string; clientId?: string },
  step: 'improve' as string | null,
  pathname: '/en/dashboard',
}))
vi.mock('next/navigation', () => ({
  useParams: () => nav.params,
  useSearchParams: () => new URLSearchParams(nav.step ? { step: nav.step } : {}),
  usePathname: () => nav.pathname,
}))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/components/dashboard/ThemeToggle', () => ({ ThemeToggle: () => null }))

import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import { resolveCommercialEntitlement } from '@/lib/tier'

const entitlement = resolveCommercialEntitlement({
  plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1',
  trial_ends_at: null, override_plan: null, override_expires_at: null,
} as never)

function links(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
    href: /href="([^"]*)"/.exec(attrs)?.[1],
    current: /aria-current="page"/.test(attrs),
    disabled: /aria-disabled="true"/.test(attrs),
    label: /(nav_[a-z_]+)/.exec(inner)?.[1],
  })).filter(link => link.label)
}

const render = () => links(renderToStaticMarkup(<DashboardSidebar profile={{}} entitlement={entitlement} />))

describe('dashboard sidebar on the brand portfolio', () => {
  it('shows and marks Start work current only when enabled inside a brand', () => {
    nav.params = { lang: 'en', clientId: 'client-1' }
    nav.pathname = '/en/dashboard/client-1/studio'
    const enabled = links(renderToStaticMarkup(<DashboardSidebar profile={{}} entitlement={entitlement} conversationStudio />))
    expect(enabled.find(link => link.label === 'nav_start_work')).toMatchObject({ href: '/en/dashboard/client-1/studio', current: true })
    expect(render().some(link => link.label === 'nav_start_work')).toBe(false)
    nav.params = { lang: 'en' }
    expect(links(renderToStaticMarkup(<DashboardSidebar profile={{}} entitlement={entitlement} conversationStudio />)).some(link => link.label === 'nav_start_work')).toBe(false)
  })
  it('labels a user without a display name by email rather than a generic "User"', () => {
    const html = renderToStaticMarkup(<DashboardSidebar profile={{ display_name: null, email: 'owner@example.com' }} entitlement={entitlement} />)
    expect(html).toContain('owner@example.com')
    expect(html).not.toContain('>User<')
  })
  it('routes platform admins to the unlocalized protected directory', () => {
    const html = renderToStaticMarkup(<DashboardSidebar profile={{ is_admin: true }} entitlement={entitlement} />)
    expect(html).toContain('href="/admin?lang=en"')
    expect(html).not.toContain('href="/en/admin"')
  })
  beforeEach(() => {
    nav.params = { lang: 'en' }
    nav.step = 'improve'
    nav.pathname = '/en/dashboard'
  })

  // The portfolio page renders only the portfolio, whatever ?step= says. Its
  // sidebar once linked every step to /dashboard?step=X — six entries rendering
  // the same page, with aria-current moving to whichever was clicked.
  it('marks only Overview current, whatever the step in the URL says', () => {
    const current = render().filter(l => l.current).map(l => l.label)

    expect(current).toEqual(['nav_overview'])
  })

  it('guides a paid user to brand selection without a plan lock', () => {
    const byLabel = Object.fromEntries(render().map(l => [l.label, l]))

    for (const label of ['nav_scan_fix', 'nav_reports']) {
      expect(byLabel[label]?.disabled, label).toBe(false)
      expect(byLabel[label]?.href).toBe('/en/dashboard#portfolio-brands')
    }
    const html = renderToStaticMarkup(<DashboardSidebar profile={{}} entitlement={entitlement} />)
    expect(html).toContain('select_brand_first')
    expect(html).not.toContain('plan_required')
    expect(byLabel.nav_overview?.href).toBe('/en/dashboard')
    expect(byLabel.nav_settings?.href).toBe('/en/dashboard/settings')
  })

  it('shows five sections at most, and hides Monitor until Pulse is scheduled', () => {
    nav.params = { lang: 'en', clientId: 'client-1' }
    nav.pathname = '/en/dashboard/client-1'
    nav.step = 'home'
    const sections = render().map(l => l.label).filter(label => ['nav_overview', 'nav_scan_fix', 'nav_monitor', 'nav_reports', 'nav_settings'].includes(label!))

    expect(sections).toEqual(['nav_overview', 'nav_scan_fix', 'nav_reports', 'nav_settings'])
  })

  it('links every page to the brand once one is in the route, and opens the current section', () => {
    nav.params = { lang: 'en', clientId: 'client-1' }
    nav.pathname = '/en/dashboard/client-1'
    const byLabel = Object.fromEntries(render().map(l => [l.label, l]))

    expect(byLabel.nav_scan_fix?.href).toBe('/en/dashboard/client-1?step=scan')
    expect(byLabel.nav_scan_fix?.current).toBe(false)
    expect(byLabel.nav_fixes?.href).toBe('/en/dashboard/client-1?step=improve')
    expect(byLabel.nav_fixes?.current).toBe(true)
    expect(byLabel.nav_tasks?.href).toBe('/en/dashboard/client-1/tasks')
    expect(byLabel.nav_reports?.href).toBe('/en/dashboard/client-1/reports')
  })

  it('marks Tasks current on a task review page', () => {
    nav.params = { lang: 'en', clientId: 'client-1' }
    nav.pathname = '/en/dashboard/client-1/work-items/w1/versions'
    nav.step = null
    const current = render().filter(l => l.current).map(l => l.label)

    expect(current).toEqual(['nav_tasks'])
  })
})
