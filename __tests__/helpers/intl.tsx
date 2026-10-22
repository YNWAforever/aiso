import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

/** Server-render with the real catalogue, so assertions read the strings users see. */
export function renderWithIntl(ui: ReactElement, locale: string = 'en'): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'zh-HK' ? zh : en} timeZone="UTC">{ui}</NextIntlClientProvider>,
  )
}
