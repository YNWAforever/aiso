import { describe, expect, it } from 'vitest'
import robots from '@/app/robots'
import { NAV } from '@/lib/navigation'
import { routing } from '@/i18n/routing'
import { localizedUrl } from '@/lib/seo'
import sitemap from '@/app/sitemap'
import { GET as getLlmsTxt } from '@/app/llms.txt/route'
import { buildLocalizedMetadata, buildSoftwareApplicationJsonLd } from '@/lib/seo'

describe('public discovery', () => {
  it('allows crawling and advertises the sitemap', () => {
    const value = robots()
    expect(value.rules).toEqual([{ userAgent: '*', allow: '/' }])
    expect(value.sitemap).toMatch(/\/sitemap\.xml$/)
  })

  it('lists exactly available routes across configured locales without duplicates', () => {
    const entries = sitemap()
    const urls = entries.map((entry) => entry.url)
    const expected = routing.locales.flatMap((locale) =>
      NAV.filter((route) => route.available).map((route) => localizedUrl(locale, route.href === '/' ? '' : route.href)),
    )
    expect([...urls].sort()).toEqual([...expected].sort())
    expect(new Set(urls).size).toBe(urls.length)
    for (const locale of routing.locales) {
      expect(entries.find((entry) => entry.url === localizedUrl(locale))).toEqual({
        url: localizedUrl(locale), changeFrequency: 'weekly', priority: 1,
      })
      expect(entries.find((entry) => entry.url === localizedUrl(locale, 'pricing'))).toEqual({
        url: localizedUrl(locale, 'pricing'), changeFrequency: 'monthly', priority: 0.8,
      })
      for (const route of NAV.filter((entry) => !entry.available)) {
        expect(urls).not.toContain(localizedUrl(locale, route.href))
      }
    }
  })

  it('follows navigation availability changes', () => {
    const route = NAV.find((entry) => !entry.available)!
    route.available = true
    try {
      expect(sitemap().map((entry) => entry.url)).toContain(localizedUrl('en', route.href))
    } finally {
      route.available = false
    }
  })

  it('follows the configured locale set', () => {
    const locales = routing.locales
    Reflect.set(routing, 'locales', ['en'])
    try {
      expect(sitemap().map((entry) => entry.url)).toEqual(
        NAV.filter((entry) => entry.available).map((entry) => localizedUrl('en', entry.href === '/' ? '' : entry.href)),
      )
    } finally {
      Reflect.set(routing, 'locales', locales)
    }
  })
  it('serves a useful plain-text llms.txt', async () => {
    const response = await getLlmsTxt()
    expect(response.headers.get('content-type')).toContain('text/plain')
    const body = await response.text()
    expect(body).toContain('# Fimmick AISO')
    expect(body).toContain('20 AI readiness checks')
    expect(body).toContain('/en/pricing')
  })

  it('builds canonical and hreflang metadata', () => {
    const metadata = buildLocalizedMetadata('en', '')
    expect(metadata.alternates?.canonical).toMatch(/\/en$/)
    expect(metadata.alternates?.languages).toMatchObject({
      en: expect.stringMatching(/\/en$/),
      'zh-HK': expect.stringMatching(/\/zh-HK$/),
      'x-default': expect.stringMatching(/\/$/),
    })
  })

  it('describes the software without guaranteeing third-party outcomes', () => {
    const json = buildSoftwareApplicationJsonLd('en')
    expect(json['@type']).toBe('SoftwareApplication')
    expect(json.description).toContain('checks')
    expect(json.description).not.toMatch(/guarantee|every AI search engine/i)
  })
})
