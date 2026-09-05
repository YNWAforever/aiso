import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NAV } from '@/lib/navigation'
import { localizedUrl, buildLocalizedMetadata } from '@/lib/seo'
import sitemap from '@/app/sitemap'

const routes = ["/platform","/platform/site-health","/platform/search-intelligence","/platform/demand-intelligence","/platform/brand-product-discovery","/platform/ai-visibility","/platform/action-studio","/platform/governed-agents","/platform/proof","/solutions","/solutions/sme","/solutions/agencies","/solutions/enterprise","/solutions/regulated-industries","/how-it-works","/resources","/contact","/security","/trust","/integrations"]

describe('approved public families', () => {
  it('enables exactly the delivered public routes and sitemap URLs', () => {
    expect(NAV.filter(entry => entry.available).map(entry => entry.href).sort()).toEqual(['/', '/pricing', ...routes, '/scan', '/methodology', '/sample-report'].sort())
    expect(sitemap()).toHaveLength(50)
    expect(sitemap().map(entry => entry.url).sort()).toEqual(['en', 'zh-HK'].flatMap(locale => ['/', '/pricing', ...routes, '/scan', '/methodology', '/sample-report'].map(path => localizedUrl(locale, path === '/' ? '' : path))).sort())
  })
  it.each([...routes, '/scan', '/methodology', '/sample-report'])('has an explicit server route and distinct localized metadata for %s', async (path) => {
    const source = readFileSync(`app/[lang]/(marketing)${path}/page.tsx`, 'utf8')
    expect(source).not.toContain('use client')
    expect(source).toContain('generateMetadata')
    expect(source).toContain(`'${path}'`)
    const en = buildLocalizedMetadata('en', path)
    const zh = buildLocalizedMetadata('zh-HK', path)
    expect(en.title).not.toEqual(zh.title)
    expect(en.description).not.toEqual(zh.description)
    expect(en.alternates?.canonical).toEqual(expect.stringContaining(`/en${path}`))
  })
})
