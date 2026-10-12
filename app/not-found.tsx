import type { Metadata } from 'next'
import Link from 'next/link'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { SiteHeader } from '@/components/marketing/SiteHeader'
import { StatusPage } from '@/components/marketing/StatusPage'

/**
 * The one 404 for the whole app.
 *
 * It sits at the root, above `app/[lang]/layout.tsx`, because an unmatched
 * URL (and an unknown locale, which that layout rejects with `notFound()`)
 * never reaches a localised layout. So it supplies its own intl provider and
 * the marketing chrome rather than inheriting them. `getLocale()` still
 * resolves the visitor's locale: `proxy.ts` runs for these paths.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notFound')
  return { title: t('meta_title'), robots: { index: false, follow: true } }
}

export default async function NotFound() {
  const locale = await getLocale()
  const messages = await getMessages()
  const t = await getTranslations('notFound')
  const nav = await getTranslations('nav')

  const popular = [
    { href: `/${locale}/pricing`, label: nav('pricing') },
    { href: `/${locale}/sample-report`, label: nav('sample_report') },
    { href: `/${locale}/how-it-works`, label: nav('company.how_it_works') },
  ]

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <SiteHeader />
      <main id="main" className="flex-1">
        <StatusPage
          code="404"
          eyebrow={t('eyebrow')}
          title={t('title')}
          body={t('body')}
          primary={{ href: `/${locale}#scan`, label: t('scan') }}
          secondary={{ href: `/${locale}`, label: t('home') }}
        >
          <nav aria-label={t('links_label')} className="mt-10 border-t border-border pt-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('links_label')}</h2>
            <ul className="mt-3 flex flex-wrap justify-center gap-x-6 gap-y-1">
              {popular.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </StatusPage>
      </main>
      <SiteFooter />
    </NextIntlClientProvider>
  )
}
