import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/**
 * The brand's assets page is where the analytics grant link returns
 * (grantAnalyticsHref), so a refused consent has to be explained here, not only
 * on Settings. Everything the page reads is mocked: these tests are about which
 * elements it composes, not about the asset data.
 */
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/workspace/load-owned-workspace', () => ({ loadOwnedWorkspace: mocks.load }))
vi.mock('@/lib/assets/store', () => ({ listAssets: async () => [], listQuestionDeclarations: async () => [] }))
vi.mock('@/lib/assets/suggestion-inputs', () => ({ loadSuggestionSources: async () => [], toRegisteredPages: () => [] }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/components/dashboard/AssetConvergenceView', () => ({ AssetConvergenceView: () => null }))

import Page from '@/app/[lang]/dashboard/[clientId]/assets/page'
import { AnalyticsPanel } from '@/components/integrations/AnalyticsPanel'
import { SearchConsolePanel } from '@/components/integrations/SearchConsolePanel'
import { GoogleConsentNotice } from '@/components/integrations/GoogleConnectionsPanel'

const pro = { id: 'p', account_id: 'account-a', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub' } }
type Lang = 'en' | 'zh-HK'
const render = (search: Record<string, string | undefined> = {}, lang: Lang = 'en') =>
  Page({ params: Promise.resolve({ lang, clientId: 'client-a' }), searchParams: Promise.resolve(search) })
const children = (page: ReactElement) =>
  [(page.props as { children: unknown }).children].flat(3).filter(Boolean) as ReactElement[]
const ofType = (page: ReactElement, type: unknown) => children(page).filter(c => c.type === type)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FEATURE_SEARCH_CONSOLE = '1'
  process.env.FEATURE_ANALYTICS = '1'
  mocks.auth.mockResolvedValue(pro)
  mocks.load.mockResolvedValue({ scan: { data: null } })
})
afterEach(() => {
  delete process.env.FEATURE_SEARCH_CONSOLE
  delete process.env.FEATURE_ANALYTICS
})

describe('a refused Google consent on the assets page', () => {
  it.each(['en', 'zh-HK'] as const)('explains analytics_not_granted above the panels (%s)', async lang => {
    const page = await render({ google: 'error', reason: 'analytics_not_granted' }, lang)
    const [notice] = ofType(page, GoogleConsentNotice)
    expect(notice?.props).toEqual({ lang, reason: 'analytics_not_granted' })
    // Above the panels: the notice comes before both Google panels in the page.
    const order = children(page).map(c => c.type)
    expect(order.indexOf(GoogleConsentNotice)).toBeLessThan(order.indexOf(SearchConsolePanel))
    expect(order.indexOf(GoogleConsentNotice)).toBeLessThan(order.indexOf(AnalyticsPanel))

    const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
    const markup = renderToStaticMarkup(notice!)
    expect(markup).toContain(copy.error_analytics_not_granted)
    expect(markup).toContain('role="status"')
  })

  it('says something different in each language', () => {
    expect(zhHK.searchConsole.error_analytics_not_granted).not.toBe(en.searchConsole.error_analytics_not_granted)
  })

  it.each([
    { google: 'error', reason: 'made_up' },
    { google: 'error', reason: 'toString' },
    { google: 'error' },
    { google: 'connected', reason: 'analytics_not_granted' },
    {},
  ])('renders no notice for %j', async search => {
    expect(ofType(await render(search), GoogleConsentNotice)).toHaveLength(0)
  })

  it('shows no notice while both Google panels are dark', async () => {
    delete process.env.FEATURE_SEARCH_CONSOLE
    delete process.env.FEATURE_ANALYTICS
    expect(ofType(await render({ google: 'error', reason: 'analytics_not_granted' }), GoogleConsentNotice)).toHaveLength(0)
  })

  it('renders nothing for an unknown reason when rendered directly', () => {
    expect(renderToStaticMarkup(<GoogleConsentNotice lang="en" reason={null} />)).toBe('')
  })
})

describe('the analytics panel follows both flags', () => {
  it('is shown with both flags on and a plan that grants it', async () => {
    expect(ofType(await render(), AnalyticsPanel)).toHaveLength(1)
  })

  it('is not shown with FEATURE_ANALYTICS on but FEATURE_SEARCH_CONSOLE off', async () => {
    delete process.env.FEATURE_SEARCH_CONSOLE
    const page = await render()
    expect(ofType(page, AnalyticsPanel)).toHaveLength(0)
    expect(ofType(page, SearchConsolePanel)).toHaveLength(0)
  })
})
