import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { PublicInformationPage, type PublicPageCopy } from '@/components/marketing/PublicInformationPage'

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: string }) => (key: string) => {
    const common = locale === 'en' ? en.publicPages.common : zh.publicPages.common
    return common[key as keyof typeof common]
  },
}))

for (const [locale, catalog] of [['en', en], ['zh-HK', zh]] as const) {
  describe(`${locale} public copy and rendered release states`, () => {
    it('gives every delivered page distinct substantive copy', () => {
      const entries = Object.entries(catalog.publicPages).filter(([key]) => key !== 'common') as [string, PublicPageCopy][]
      expect(entries).toHaveLength(20)
      for (const field of ['title', 'summary', 'evidence', 'limitations'] as const) {
        expect(new Set(entries.map(([, copy]) => copy[field])).size).toBe(20)
      }
      for (const [, copy] of entries) expect(copy.actions).toHaveLength(3)
    })
    it.each(['platform_brand_product_discovery', 'platform_governed_agents'] as const)('labels %s as planned with no implied launch action', async key => {
      const html = renderToStaticMarkup(await PublicInformationPage({ lang: locale, copy: catalog.publicPages[key], planned: true }))
      expect(html).toContain(catalog.publicPages.common.planned)
      expect(html).toContain(catalog.publicPages.common.proposed)
      expect(html).not.toContain(`/${locale}/auth/login`)
      expect(html).toContain(`/${locale}#scan`)
      expect(html.match(/<h1\b/g)).toHaveLength(1)
    })
    it('uses the existing scan and sign-in journey for an available capability', async () => {
      const html = renderToStaticMarkup(await PublicInformationPage({ lang: locale, copy: catalog.publicPages.platform_site_health }))
      expect(html).toContain(`/${locale}#scan`)
      expect(html).toContain(`/${locale}/auth/login`)
      expect(html).not.toContain(catalog.publicPages.common.planned)
    })
    it('does not turn contact into a message submission', async () => {
      const html = renderToStaticMarkup(await PublicInformationPage({ lang: locale, copy: catalog.publicPages.contact }))
      expect(html).not.toContain('<form')
      expect(html).not.toContain('mailto:')
      expect(html).toContain(catalog.publicPages.contact.limitations)
    })
  })
}
