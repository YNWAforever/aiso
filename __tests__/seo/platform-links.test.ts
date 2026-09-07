import { describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { NAV } from '@/lib/navigation'
import Page from '@/app/[lang]/(marketing)/platform/page'

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const catalog = locale === 'en' ? en : zh
    const read = (key: string) => `${namespace}.${key}`.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalog)
    return Object.assign(read, { raw: read })
  },
}))

describe('platform overview capability links', () => {
  it.each(['en', 'zh-HK'])('links all eight available capabilities with %s labels', async lang => {
    const page = await Page({ params: Promise.resolve({ lang }) })
    const links = page.props.related as { href: string; label: string }[]
    expect(links).toHaveLength(8)
    expect(links.map(link => link.href)).toEqual(NAV.filter(entry => entry.section === 'platform' && entry.href !== '/platform' && entry.available).map(entry => entry.href))
    expect(links.every(link => link.label && !link.label.startsWith('nav.'))).toBe(true)
  })
  it('omits an unavailable capability', async () => {
    const entry = NAV.find(entry => entry.href === '/platform/site-health')!
    entry.available = false
    try {
      const page = await Page({ params: Promise.resolve({ lang: 'en' }) })
      expect(page.props.related).not.toEqual(expect.arrayContaining([expect.objectContaining({ href: entry.href })]))
    } finally {
      entry.available = true
    }
  })
})
