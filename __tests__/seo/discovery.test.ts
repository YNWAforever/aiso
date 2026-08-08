import { describe, expect, it } from 'vitest'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { GET as getLlmsTxt } from '@/app/llms.txt/route'
import { buildLocalizedMetadata, buildSoftwareApplicationJsonLd } from '@/lib/seo'

describe('public discovery', () => {
  it('allows crawling and advertises the sitemap', () => {
    const value = robots()
    expect(value.rules).toEqual([{ userAgent: '*', allow: '/' }])
    expect(value.sitemap).toMatch(/\/sitemap\.xml$/)
  })

  it('lists both locales and public acquisition routes', () => {
    const urls = sitemap().map((entry) => entry.url)
    expect(urls).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/en$/),
      expect.stringMatching(/\/zh-HK$/),
      expect.stringMatching(/\/en\/pricing$/),
      expect.stringMatching(/\/zh-HK\/pricing$/),
    ]))
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
