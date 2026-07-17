import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { buildLocalizedMetadata } from '@/lib/seo'

type LangLayoutProps = {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}

export async function generateMetadata({ params }: LangLayoutProps): Promise<Metadata> {
  const { lang } = await params
  if (!(routing.locales as readonly string[]).includes(lang)) notFound()

  return buildLocalizedMetadata(lang)
}

export default async function LangLayout({ children, params }: LangLayoutProps) {
  const { lang } = await params
  if (!(routing.locales as readonly string[]).includes(lang)) notFound()

  setRequestLocale(lang)
  const messages = await getMessages()

  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
}
