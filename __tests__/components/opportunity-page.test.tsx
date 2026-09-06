import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { initial } from './c9c-fixtures'
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  owned: vi.fn(),
  ServiceError: class extends Error {
    constructor(public code: string) {
      super(code)
    }
  },
}))
vi.mock('@/lib/auth', () => ({ requireAuth: h.auth }))
vi.mock('@/lib/work-items/store', () => ({ loadOwnedDraftClient: h.owned }))
vi.mock('@/lib/opportunities/service', () => ({
  loadAuthenticatedOpportunities: h.load,
  OpportunityServiceError: h.ServiceError,
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Error(`redirect:${url}`)
  },
  notFound: () => {
    throw Error('not-found')
  },
}))
vi.mock('next-intl/server', () => ({
  getTranslations:
    async ({ locale }: { locale: string }) =>
    (key: string) =>
      String(
        (locale === 'en' ? en : zh).opportunities[
          key as keyof typeof en.opportunities
        ],
      ),
}))
import Page from '@/app/[lang]/dashboard/[clientId]/opportunities/page'
function renderPage(page: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={testLang}
      timeZone="UTC"
      messages={testLang === 'en' ? en : zh}
    >
      {page}
    </NextIntlClientProvider>,
  )
}
let testLang = 'zh-HK'
beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ account_id: 'account' })
  h.owned.mockReset().mockResolvedValue({ id: 'client' })
  h.load.mockReset()
  testLang = 'zh-HK'
})
describe('opportunity page boundary', () => {
  it('authenticates independently before reading sources', async () => {
    h.auth.mockRejectedValue(Error('login'))
    await expect(
      Page({ params: Promise.resolve({ lang: 'zh-HK', clientId: 'client' }) }),
    ).rejects.toThrow('login')
    expect(h.load).not.toHaveBeenCalled()
  })
  it('awaits params and supplies the owned read to the workspace', async () => {
    h.load.mockResolvedValue(initial)
    const html = renderPage(
      await Page({
        params: Promise.resolve({ lang: 'zh-HK', clientId: 'client' }),
      }),
    )
    expect(h.auth).toHaveBeenCalledWith('zh-HK')
    expect(h.load).toHaveBeenCalledWith('client')
    expect(html).toContain(zh.opportunities.savedDrafts)
  })
  it.each(['CLIENT_NOT_FOUND', 'INVALID_OPPORTUNITY_QUERY'])(
    'hides %s',
    async (code) => {
      h.load.mockRejectedValue(new h.ServiceError(code))
      await expect(
        Page({ params: Promise.resolve({ lang: 'en', clientId: 'client' }) }),
      ).rejects.toThrow('not-found')
    },
  )
  it('redirects when service authentication expires', async () => {
    h.load.mockRejectedValue(new h.ServiceError('UNAUTHENTICATED'))
    await expect(
      Page({ params: Promise.resolve({ lang: 'en', clientId: 'client' }) }),
    ).rejects.toThrow('redirect:/en/auth/login')
  })
  it.each(['en', 'zh-HK'])(
    'renders initial-load retry without claiming existing findings in %s',
    async (lang) => {
      testLang = lang
      h.load.mockRejectedValue(new h.ServiceError('OPPORTUNITIES_UNAVAILABLE'))
      const html = renderPage(
        await Page({
          params: Promise.resolve({ lang, clientId: 'client' }),
        }),
      )
      const copy = (lang === 'en' ? en : zh).opportunities
      expect(html).toContain(copy.initialLoadError)
      expect(html).not.toContain(copy.loadError)
      expect(html).toContain(copy.savedDrafts)
      expect(html).toContain(copy.refresh)
      expect(html).not.toContain(copy.empty)
      expect(h.owned).toHaveBeenCalledWith('account', 'client')
      expect(html).not.toContain('OPPORTUNITIES_UNAVAILABLE')
    },
  )
  it.each(['en', 'zh-HK'])(
    'does not expose the workspace when fallback ownership is denied in %s',
    async (lang) => {
      h.load.mockRejectedValue(new h.ServiceError('OPPORTUNITIES_UNAVAILABLE'))
      h.owned.mockResolvedValue(null)
      await expect(
        Page({ params: Promise.resolve({ lang, clientId: 'client' }) }),
      ).rejects.toThrow('not-found')
    },
  )
  it('keeps the workspace hidden when ownership cannot be verified', async () => {
    h.load.mockRejectedValue(new h.ServiceError('OPPORTUNITIES_UNAVAILABLE'))
    h.owned.mockRejectedValue(Error('private SQL detail'))
    const html = renderPage(
      await Page({
        params: Promise.resolve({ lang: 'zh-HK', clientId: 'client' }),
      }),
    )
    expect(html).toContain(zh.opportunities.initialLoadError)
    expect(html).not.toContain(zh.opportunities.savedDrafts)
    expect(html).not.toContain('private SQL detail')
  })
  it('keeps unexpected service diagnostics out of initial-load failures', async () => {
    h.load.mockRejectedValue(Error('private SQL detail'))
    const html = renderPage(
      await Page({
        params: Promise.resolve({ lang: 'zh-HK', clientId: 'client' }),
      }),
    )
    expect(html).toContain(zh.opportunities.initialLoadError)
    expect(html).not.toContain('private SQL detail')
  })
})
