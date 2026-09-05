import { describe, expect, it } from 'vitest'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { NAV } from '@/lib/navigation'
import { routing } from '@/i18n/routing'
import { buildLocalizedMetadata, seoMessageKey, localizedUrl, SITE_URL } from '@/lib/seo'

const catalogs = { en, 'zh-HK': zhHK }

function assertMetadataCoverage(catalog: unknown, locale: string) {
  for (const route of NAV.filter((entry) => entry.available)) {
    for (const field of ['title', 'description']) {
      const key = `${seoMessageKey(route.href)}.${field}`
      const value = key.split('.').reduce<unknown>((node, segment) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined,
      catalog)
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${locale}: missing ${key}`)
      }
    }
  }
}

describe('metadata catalog coverage', () => {
  it.each(routing.locales)('covers every available route in %s', (locale) => {
    expect(() => assertMetadataCoverage(catalogs[locale], locale)).not.toThrow()
  })

  it.each(routing.locales)('names each missing %s key on a cloned catalog', (locale) => {
    for (const page of ['home', 'pricing'] as const) {
      for (const field of ['title', 'description'] as const) {
        const catalog = structuredClone(catalogs[locale])
        Reflect.deleteProperty(catalog.seo[page], field)
        expect(() => assertMetadataCoverage(catalog, locale))
          .toThrow(`${locale}: missing seo.${page}.${field}`)
      }
    }
  })

  it.each([
    ['', 'seo.home'], ['/', 'seo.home'], ['pricing', 'seo.pricing'],
    ['/pricing/', 'seo.pricing'], ['/platform/site-health/', 'seo.platform.site-health'],
  ])('normalizes %s to %s', (path, key) => {
    expect(seoMessageKey(path)).toBe(key)
  })

  it.each(routing.locales)('resolves %s page copy and preserves sharing and URL metadata', (locale) => {
    for (const [path, page] of [['', 'home'], ['/', 'home'], ['pricing', 'pricing'], ['/pricing/', 'pricing']] as const) {
      const { title, description } = catalogs[locale].seo[page]
      const metadata = buildLocalizedMetadata(locale, path)
      expect(metadata.title).toBe(title)
      expect(metadata.description).toBe(description)
      expect(metadata.alternates).toEqual({
        canonical: localizedUrl(locale, path),
        languages: {
          en: localizedUrl('en', path),
          'zh-HK': localizedUrl('zh-HK', path),
          'x-default': new URL('/', SITE_URL).toString(),
        },
      })
      expect(metadata.openGraph).toEqual({
        type: 'website', url: localizedUrl(locale, path), siteName: 'Fimmick AISO',
        locale: locale === 'zh-HK' ? 'zh_HK' : 'en_US', title, description,
      })
      expect(metadata.twitter).toEqual({ card: 'summary_large_image', title, description })
    }
  })

  it('does not silently substitute home copy for an unknown page', () => {
    expect(() => buildLocalizedMetadata('en', '/not-built')).toThrow('seo.not-built.title')
  })
})
