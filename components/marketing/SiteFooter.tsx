'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Zap } from 'lucide-react'
import { NAV, type NavSection } from '@/lib/navigation'

/**
 * The public footer, rendered once by `app/[lang]/(marketing)/layout.tsx`.
 *
 * Drawn from the same `NAV` config as the header, so the two cannot disagree
 * about which pages exist. The pricing page's old footer sat *inside* its
 * `<main>`, which put the whole thing outside the `contentinfo` landmark; this
 * one is a sibling of `<main>`, which is where a footer has to be to count.
 */

const GROUPED_SECTIONS: NavSection[] = ['platform', 'solutions', 'company']

export function SiteFooter() {
  const t = useTranslations('nav')
  const locale = useLocale()

  const available = NAV.filter((entry) => entry.available)
  const topEntries = available.filter((entry) => entry.section === 'top')
  const groups = GROUPED_SECTIONS.map((section) => ({
    section,
    entries: available.filter((entry) => entry.section === section),
  })).filter((group) => group.entries.length > 0)

  const linkClass = 'min-h-11 content-center transition-colors hover:text-foreground'

  return (
    <footer className="border-t border-border bg-card px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 text-sm text-muted-foreground sm:flex-row">
        <div className="flex flex-col items-center gap-1 sm:items-start">
          <span className="flex items-center gap-2 font-bold text-foreground">
            <Zap aria-hidden="true" className="size-4 text-primary" />
            {t('brand_name')} {t('brand_product')}
          </span>
          <span className="text-xs">{t('tagline')}</span>
        </div>

        <nav
          aria-label={t('footer_label')}
          className="flex flex-wrap items-start justify-center gap-x-8 gap-y-4"
        >
          <ul className="flex flex-wrap items-center justify-center gap-5">
            {topEntries.map((entry) => (
              <li key={entry.href}>
                <Link
                  href={entry.href === '/' ? `/${locale}` : `/${locale}${entry.href}`}
                  className={linkClass}
                >
                  {t(entry.labelKey.replace(/^nav\./, ''))}
                </Link>
              </li>
            ))}
            <li>
              <Link href={`/${locale}/auth/login`} className={linkClass}>
                {t('sign_in')}
              </Link>
            </li>
          </ul>

          {/*
            Empty today, and so absent from the DOM today. Same rule as the
            header: an unavailable entry renders nowhere rather than hidden.
          */}
          {groups.map(({ section, entries }) => (
            <div key={section} className="text-center sm:text-left">
              <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                {t(`sections.${section}`)}
              </h2>
              <ul className="mt-2 space-y-1">
                {entries.map((entry) => (
                  <li key={entry.href}>
                    <Link href={`/${locale}${entry.href}`} className={linkClass}>
                      {t(entry.labelKey.replace(/^nav\./, ''))}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <span>{t('copyright')}</span>
      </div>
    </footer>
  )
}
