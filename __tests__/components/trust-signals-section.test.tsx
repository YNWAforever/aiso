import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TrustSignalsSection } from '@/components/result/TrustSignalsSection'
import { assessTrustSignals } from '@/lib/trust-signals'

const messages = (locale: 'en' | 'zh-HK') =>
  JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), 'utf8'))
const render = (value: unknown, locale: 'en' | 'zh-HK' = 'en') => renderToStaticMarkup(
  <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
    <TrustSignalsSection value={value} />
  </NextIntlClientProvider>,
)

const value = assessTrustSignals(
  '<html><head><meta name="author" content="Jane"></head><body><a href="/privacy">Privacy</a></body></html>',
  'https://example.com/',
)

describe('TrustSignalsSection', () => {
  it('lists every signal with a text status, and says it does not change the score', () => {
    const html = render(value)
    expect(html).toContain('Trust and E-E-A-T signals')
    expect(html).toContain('they do not change your score')
    expect(html).toContain('2 of 10 present')          // author and HTTPS
    expect(html).toContain('Named author <span class="font-normal text-slate-600">· Present</span>')
    expect(html).toContain('Privacy policy and terms <span class="font-normal text-slate-600">· Partly there</span>')
    expect(html).toContain('Physical address <span class="font-normal text-slate-600">· Missing</span>')
  })

  it('shows a fix only for signals that are not present', () => {
    const html = render(value)
    expect(html).toContain('Link to both your privacy policy and your terms of use.')
    expect(html).not.toContain('Show who wrote the page')
    expect(html).not.toContain('Serve the page over HTTPS.')
  })

  it('renders in Traditional Chinese', () => {
    const html = render(value, 'zh-HK')
    expect(html).toContain('信任及 E-E-A-T 訊號')
    expect(html).toContain('10 項中已具備 2 項')
    expect(html).toContain('具名作者')
    expect(html).toContain('已具備')
  })

  it.each([undefined, null, {}, { signals: 'x' }, { signals: [{ key: 'unknown', status: 'pass' }] }])(
    'renders nothing for a scan without valid trust signals: %j', stored => {
      expect(render(stored)).toBe('')
    },
  )
})
