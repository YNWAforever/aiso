import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider, createTranslator } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
vi.mock('next-intl/server', () => ({ getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => createTranslator({ locale, messages: locale === 'zh-HK' ? zh : en, namespace: namespace as never }) }))
vi.mock('@/components/home/ScanForm', () => ({ ScanForm: () => <form data-testid="scan-form" /> }))
import HomePage from '@/app/[lang]/(marketing)/page'

const catalogs = { en, 'zh-HK': zh } as const

async function render(lang: keyof typeof catalogs) {
  const page = await HomePage({ params: Promise.resolve({ lang }) })
  return renderToStaticMarkup(<NextIntlClientProvider locale={lang} timeZone="UTC" messages={catalogs[lang]}>{page}</NextIntlClientProvider>)
}

const words = (text: string) => text.trim().split(/\s+/).length
const cjk = (text: string) => (text.match(/[㐀-鿿]/g) ?? []).length

describe('landing page', () => {
  it.each(['en', 'zh-HK'] as const)('has one h1, two scan forms and every section (%s)', async lang => {
    const html = await render(lang)
    const copy = catalogs[lang].landing
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain(copy.hero.title)
    expect(html.match(/data-testid="scan-form"/g)).toHaveLength(2)
    for (const id of ['how-title', 'checks-title', 'compare-title', 'sample-title', 'pricing-title', 'faq-title', 'final-title']) expect(html).toContain(`id="${id}"`)
    expect(html).toContain('"@type":"FAQPage"')
    expect(html).toContain(copy.compare.illustration)
  })

  it('renders different copy per language rather than an English fallback', async () => {
    const zhHtml = await render('zh-HK')
    expect(zhHtml).toContain(zh.landing.hero.title)
    expect(zhHtml).not.toContain(en.landing.hero.title)
  })

  it('keeps every landing heading within the text budget', () => {
    for (const [lang, catalog] of Object.entries(catalogs)) {
      for (const [section, value] of Object.entries(catalog.landing)) {
        const title = (value as Record<string, unknown>).title
        if (typeof title !== 'string') continue
        if (lang === 'en') expect(words(title), `${lang} landing.${section}.title`).toBeLessThanOrEqual(8)
        else expect(cjk(title), `${lang} landing.${section}.title`).toBeLessThanOrEqual(14)
      }
    }
  })
})
