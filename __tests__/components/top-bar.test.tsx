import { beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({
  params: { lang: 'en' } as { lang: string; clientId?: string },
  step: null as string | null,
  pathname: '/en/dashboard',
}))
vi.mock('next/navigation', () => ({
  useParams: () => nav.params,
  useSearchParams: () => new URLSearchParams(nav.step ? { step: nav.step } : {}),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/components/dashboard/NotificationBell', () => ({ NotificationBell: () => <span data-bell /> }))

import { TopBar } from '@/components/dashboard/shell/TopBar'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'

const brands = [{ id: 'c1', name: 'Acme', domain: 'acme.test' }, { id: 'c2', name: 'Globex', domain: null }]
const features = { agent_recs: true, edit_prompts: true }

function crumbs(html: string) {
  const trail = /<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? ''
  return [...trail.matchAll(/<(a|span)\b[^>]*>([^<]+)<\/\1>/g)].map(m => m[2].replace(/&amp;/g, '&'))
}

describe('TopBar', () => {
  beforeEach(() => {
    nav.params = { lang: 'en' }
    nav.step = null
    nav.pathname = '/en/dashboard'
  })

  it('shows only the brands crumb on the portfolio, and no brand switcher', () => {
    const html = renderWithIntl(<TopBar lang="en" brands={brands} unreadCount={0} features={features} />)
    expect(crumbs(html)).toEqual([en.dashboard.shell.brands])
    expect(html).not.toContain(en.dashboard.shell.switch_brand)
  })

  it('walks Brands › brand › section › page and marks the last crumb current', () => {
    nav.params = { lang: 'en', clientId: 'c1' }
    nav.pathname = '/en/dashboard/c1/work-items/w1/versions'
    const html = renderWithIntl(<TopBar lang="en" brands={brands} unreadCount={0} features={features} />)

    expect(crumbs(html)).toEqual([en.dashboard.shell.brands, 'Acme', en.dashboard.nav_scan_fix, en.dashboard.nav_tasks])
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*>${en.dashboard.nav_tasks}<`))
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it('names Local visibility under Overview', () => {
    nav.params = { lang: 'en', clientId: 'c1' }
    nav.pathname = '/en/dashboard/c1'
    nav.step = 'roi'
    const html = renderWithIntl(<TopBar lang="en" brands={brands} unreadCount={0} features={features} />)
    expect(crumbs(html)).toEqual([en.dashboard.shell.brands, 'Acme', en.dashboard.nav_overview, en.dashboard.local_visibility])
  })

  it('lists every brand in the switcher, marking the current one', () => {
    nav.params = { lang: 'en', clientId: 'c2' }
    nav.pathname = '/en/dashboard/c2'
    const html = renderWithIntl(<TopBar lang="en" brands={brands} unreadCount={0} features={features} />)
    expect(html).toContain('href="/en/dashboard/c1?step=home"')
    expect(html).toMatch(/<a aria-current="true"[^>]*href="\/en\/dashboard\/c2\?step=home"/)
    expect(html).not.toMatch(/<a aria-current="true"[^>]*href="\/en\/dashboard\/c1/)
    expect(html).toContain('aria-expanded="false"')
  })

  it('says the brand list is unavailable rather than showing none', () => {
    nav.params = { lang: 'en', clientId: 'c1' }
    nav.pathname = '/en/dashboard/c1'
    const html = renderWithIntl(<TopBar lang="en" brands={null} unreadCount={null} features={features} />)
    expect(html).toContain(en.dashboard.shell.brands_unavailable)
  })
})
