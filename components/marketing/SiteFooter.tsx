'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, Zap } from 'lucide-react'
import { NAV, type NavSection } from '@/lib/navigation'

/**
 * The public footer, rendered once by `app/[lang]/(marketing)/layout.tsx`.
 *
 * Drawn from the same `NAV` config as the header, so the two cannot disagree
 * about which pages exist. The pricing page's old footer sat *inside* its
 * `<main>`, which put the whole thing outside the `contentinfo` landmark; this
 * one is a sibling of `<main>`, which is where a footer has to be to count.
 *
 * Layout is a fixed grid — a brand column plus one column per section — so
 * the columns never reflow into each other the way the old flex-wrap row did
 * once Platform grew to nine entries.
 */

const GROUPED_SECTIONS: NavSection[] = ['platform', 'solutions', 'company']

export function SiteFooter() {
  const t = useTranslations('nav')
  const locale = useLocale()

  const available = NAV.filter((entry) => entry.available)
  const href = (path: string) => (path === '/' ? `/${locale}` : `/${locale}${path}`)
  const label = (key: string) => t(key.replace(/^nav\./, ''))

  const columns = [
    {
      key: 'product',
      heading: t('sections.product'),
      links: [
        ...available
          .filter((entry) => entry.section === 'top')
          .map((entry) => ({ href: href(entry.href), label: label(entry.labelKey) })),
        { href: `/${locale}/auth/login`, label: t('sign_in') },
      ],
    },
    ...GROUPED_SECTIONS.map((section) => ({
      key: section,
      heading: t(`sections.${section}`),
      links: available
        .filter((entry) => entry.section === section)
        .map((entry) => ({ href: href(entry.href), label: label(entry.labelKey) })),
    })),
  ].filter((column) => column.links.length > 0)

  const linkClass =
    'inline-flex min-h-8 items-center rounded-md text-sm [overflow-wrap:anywhere] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-14 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
          <div className="max-w-sm">
            <Link
              href={`/${locale}`}
              className="inline-flex items-center gap-2 rounded-lg font-black tracking-tight text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary">
                <Zap aria-hidden="true" className="size-4 text-primary-foreground" />
              </span>
              <span>
                {t('brand_name')} <span className="text-primary">{t('brand_product')}</span>
              </span>
            </Link>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">{t('footer_blurb')}</p>
            <Link
              href={`/${locale}#scan`}
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-accessible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('get_started')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>

          <nav
            aria-label={t('footer_label')}
            className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-6 gap-y-10 lg:col-span-4"
          >
            {columns.map((column) => (
              <div key={column.key}>
                <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  {column.heading}
                </h2>
                <ul className="mt-3 space-y-0.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={linkClass}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>{t('copyright')}</span>
          <span>{t('tagline')}</span>
        </div>
      </div>
    </footer>
  )
}
