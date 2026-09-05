import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const load = vi.hoisted(() => vi.fn())
vi.mock('@/lib/entities/service', () => ({
  loadAuthenticatedEntityPage: load,
  EntityServiceError: class extends Error {
    constructor(public code: string) {
      super(code)
    }
  },
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  notFound: () => {
    throw new Error('not-found')
  },
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    Object.assign((key: string) => key, { raw: () => ({ title: 'title' }) }),
}))
import Page from '@/app/[lang]/dashboard/[clientId]/entities/page'
import { EntityServiceError } from '@/lib/entities/service'
const params = Promise.resolve({ lang: 'zh-HK', clientId: 'client-a' })
beforeEach(() => {
  load.mockReset()
})
describe('entity page boundary', () => {
  it('renders the authenticated owned client', async () => {
    load.mockResolvedValue({
      client: { id: 'client-a', brand_name: 'Brand' },
      entity: null,
    })
    expect(renderToStaticMarkup(await Page({ params }))).toContain('Brand')
    expect(load).toHaveBeenCalledWith('client-a')
  })
  it('redirects signed-out users to localized login and safe next', async () => {
    load.mockRejectedValue(new EntityServiceError('UNAUTHENTICATED'))
    await expect(Page({ params })).rejects.toThrow(
      'redirect:/zh-HK/auth/login?next=%2Fzh-HK%2Fdashboard%2Fclient-a%2Fentities',
    )
  })
  it.each(['INVALID_ENTITY_INPUT', 'CLIENT_NOT_FOUND'] as const)(
    'hides %s',
    async (code) => {
      load.mockRejectedValue(new EntityServiceError(code))
      await expect(Page({ params })).rejects.toThrow('not-found')
    },
  )
  it('shows retry on failed load, never an empty editable draft', async () => {
    load.mockRejectedValue(new EntityServiceError('ENTITY_UNAVAILABLE'))
    const html = renderToStaticMarkup(await Page({ params }))
    expect(html).toContain('loadError')
    expect(html).toContain('href="/zh-HK/dashboard/client-a/entities"')
    expect(html).not.toContain('<input')
  })
})
