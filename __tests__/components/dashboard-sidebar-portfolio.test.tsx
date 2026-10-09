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
    label: /<p[^>]*>(nav_[a-z]+)<\/p>/.exec(inner)?.[1],
  })).filter(link => link.label)
}

const render = () => links(renderToStaticMarkup(<DashboardSidebar profile={{}} entitlement={entitlement} />))

describe('dashboard sidebar on the brand portfolio', () => {
  beforeEach(() => {
    nav.params = { lang: 'en' }
    nav.step = 'improve'
    nav.pathname = '/en/dashboard'
  })

  // The portfolio page renders only the portfolio, whatever ?step= says. Its
  // sidebar linked every step to /dashboard?step=X — six entries rendering the
  // same page, with aria-current moving to whichever was clicked.
  it('marks only Home current, whatever the step in the URL says', () => {
    const current = render().filter(l => l.current).map(l => l.label)

    expect(current).toEqual(['nav_home'])
  })

  it('disables every step that needs a brand, and Home goes to the portfolio', () => {
    const byLabel = Object.fromEntries(render().map(l => [l.label, l]))

    for (const label of ['nav_scan', 'nav_results', 'nav_improve', 'nav_monitor', 'nav_roi']) {
      expect(byLabel[label]?.disabled, label).toBe(true)
    }
    expect(byLabel.nav_home?.disabled).toBe(false)
    expect(byLabel.nav_home?.href).toBe('/en/dashboard')
  })

  it('links every step to the brand once one is in the route', () => {
    nav.params = { lang: 'en', clientId: 'client-1' }
    nav.pathname = '/en/dashboard/client-1'
    const byLabel = Object.fromEntries(render().map(l => [l.label, l]))

    expect(byLabel.nav_improve?.href).toBe('/en/dashboard/client-1?step=improve')
    expect(byLabel.nav_improve?.disabled).toBe(false)
    expect(byLabel.nav_improve?.current).toBe(true)
  })
})
