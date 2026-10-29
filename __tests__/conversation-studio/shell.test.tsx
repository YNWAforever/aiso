import { expect, it, vi } from 'vitest'
const route = vi.hoisted(() => ({ pathname: '/en/dashboard/11111111-1111-4111-8111-111111111111/studio' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }))
import { DashboardChrome } from '@/components/dashboard/shell/DashboardChrome'
import { buildStudioTools } from '@/lib/conversation-studio/navigation'
import { renderWithIntl } from '@/__tests__/helpers/intl'

it.each(['/en/dashboard/11111111-1111-4111-8111-111111111111/studio', '/zh-HK/dashboard/11111111-1111-4111-8111-111111111111/studio/threads', '/en/dashboard/11111111-1111-4111-8111-111111111111/studio/connections'])('uses full-bleed chrome only for Studio: %s', pathname => {
  route.pathname = pathname
  const html = renderWithIntl(<DashboardChrome conversationStudio sidebar={<div>global-sidebar</div>} topbar={<div>global-topbar</div>} banner={<div>global-banner</div>}><div>studio-content</div></DashboardChrome>)
  expect(html).toContain('studio-content')
  expect(html).not.toMatch(/global-sidebar|global-topbar|global-banner/)
})
it.each(['/en/dashboard', '/en/dashboard/11111111-1111-4111-8111-111111111111?step=home', '/en/dashboard/11111111-1111-4111-8111-111111111111/studio-copy', '/en/dashboard/11111111-1111-4111-8111-111111111111/sources', '/en/dashboard/settings/studio'])('keeps dashboard chrome outside Studio: %s', pathname => {
  route.pathname = pathname
  const html = renderWithIntl(<DashboardChrome conversationStudio sidebar={<div>global-sidebar</div>} topbar={<div>global-topbar</div>}><div>dashboard-content</div></DashboardChrome>)
  expect(html).toContain('global-sidebar')
  expect(html).toContain('global-topbar')
})
it('uses the dashboard nav destinations and keeps hidden Monitor and admin gated', () => {
  const items = buildStudioTools({ lang: 'en', clientId: '11111111-1111-4111-8111-111111111111', features: {}, admin: false })
  expect(items.find(i => i.key === 'overview')?.href).toBe('/en/dashboard/11111111-1111-4111-8111-111111111111?step=home')
  expect(items.find(i => i.key === 'improve')?.locked).toBe(true)
  expect(items.find(i => i.key === 'roi')?.href).toBe('/en/dashboard/11111111-1111-4111-8111-111111111111?step=roi')
  for (const key of ['monitor', 'prompts', 'competitors', 'observations', 'citations', 'admin']) expect(items.some(i => i.key === key)).toBe(false)
  expect(buildStudioTools({ lang: 'zh-HK', clientId: '11111111-1111-4111-8111-111111111111', features: { agent_recs: true }, admin: true }).find(i => i.key === 'admin')?.href).toBe('/admin?lang=zh-HK')
})
