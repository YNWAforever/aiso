import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  ServiceError: class extends Error {
    constructor(public code: string) {
      super(code)
    }
  },
}))
vi.mock('@/lib/auth', () => ({ requireAuth: h.auth }))
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
vi.mock('@/components/opportunities/OpportunityWorkspace', () => ({
  OpportunityWorkspace: ({ clientId }: { clientId: string }) => (
    <div>{clientId}</div>
  ),
}))
import Page from '@/app/[lang]/dashboard/[clientId]/opportunities/page'
beforeEach(() => {
  h.auth.mockReset()
  h.load.mockReset()
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
    h.load.mockResolvedValue({})
    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ lang: 'zh-HK', clientId: 'client' }),
      }),
    )
    expect(h.auth).toHaveBeenCalledWith('zh-HK')
    expect(h.load).toHaveBeenCalledWith('client')
    expect(html).toContain('client')
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
      h.load.mockRejectedValue(new h.ServiceError('OPPORTUNITIES_UNAVAILABLE'))
      const html = renderToStaticMarkup(
        await Page({
          params: Promise.resolve({ lang, clientId: 'client' }),
        }),
      )
      const copy = (lang === 'en' ? en : zh).opportunities
      expect(html).toContain(copy.initialLoadError)
      expect(html).not.toContain(copy.loadError)
      expect(html).toContain('/' + lang + '/dashboard/client/opportunities')
      expect(html).not.toContain('OPPORTUNITIES_UNAVAILABLE')
    },
  )
  it('keeps unexpected service diagnostics out of initial-load failures', async () => {
    h.load.mockRejectedValue(Error('private SQL detail'))
    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ lang: 'zh-HK', clientId: 'client' }),
      }),
    )
    expect(html).toContain(zh.opportunities.initialLoadError)
    expect(html).not.toContain('private SQL detail')
  })
})
