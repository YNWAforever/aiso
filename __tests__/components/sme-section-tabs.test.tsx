import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SmeSectionTabs } from '@/components/dashboard/shell/SmeSectionTabs'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const clientId = '11111111-1111-4111-8111-111111111111'
const nav = vi.hoisted(() => ({
  pathname: '/en/dashboard/11111111-1111-4111-8111-111111111111',
  search: new URLSearchParams(),
  params: { lang: 'en', clientId: '11111111-1111-4111-8111-111111111111' },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.search,
  useParams: () => nav.params,
}))

const base = `/en/dashboard/${clientId}`

function show(input: { pathname: string; step?: string; locale?: string }) {
  nav.pathname = input.pathname
  nav.search = new URLSearchParams(input.step ? { step: input.step } : {})
  nav.params = { lang: input.locale ?? 'en', clientId }
  return renderWithIntl(<SmeSectionTabs />, input.locale ?? 'en')
}

beforeEach(() => { nav.search = new URLSearchParams() })

describe('SME section tabs', () => {
  it('shows the What AI says tabs with the visibility one active for ?step=monitor', () => {
    const html = show({ pathname: base, step: 'monitor' })
    expect(html).toContain('What AI says')
    for (const label of ['Visibility', 'AI answer log', 'Cited sources', 'Competitors', 'Monitored questions']) expect(html).toContain(label)
    expect(html).toContain(`${base}?step=monitor`)
    expect(html).toContain(`${base}/observations`)
    expect(html).toMatch(new RegExp(`<a[^>]*aria-current="page"[^>]*>${en.smeTabs.visibility}</a>`))
  })

  it('shows the Improve tabs with the page URL matching the active tab', () => {
    const current = (label: string) => new RegExp(`<a[^>]*aria-current="page"[^>]*>${label}</a>`)
    expect(show({ pathname: `${base}/observations` })).toMatch(current(en.smeTabs.answers))
    expect(show({ pathname: base, step: 'scan' })).toMatch(current(en.smeTabs.scan))
    expect(show({ pathname: base, step: 'results' })).toMatch(current(en.smeTabs.results))
    expect(show({ pathname: `${base}/opportunities` })).toMatch(current(en.smeTabs.suggestions))
    expect(show({ pathname: `${base}/tasks` })).toMatch(current(en.smeTabs.todos))
    expect(show({ pathname: `${base}/tasks` })).toContain(`${base}?step=improve`)
  })

  it('renders nothing for Today, Chat, Reports or account pages', () => {
    expect(show({ pathname: base })).toBe('')
    expect(show({ pathname: base, step: 'roi' })).toBe('')
    expect(show({ pathname: `${base}/studio` })).toBe('')
    expect(show({ pathname: `${base}/this-month` })).toBe('')
    expect(show({ pathname: `${base}/entities` })).toBe('')
  })

  it('uses the reader’s language for both the tabs and the section label', () => {
    const html = show({ pathname: `/zh-HK/dashboard/${clientId}/citations`, locale: 'zh-HK' })
    expect(html).toContain(zh.smeTabs.whatAiSays)
    expect(html).toContain(zh.smeTabs.citations)
    expect(html).toMatch(new RegExp(`<a[^>]*aria-current="page"[^>]*>${zh.smeTabs.citations}</a>`))
  })
})
