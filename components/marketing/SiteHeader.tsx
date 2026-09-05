'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Zap } from 'lucide-react'
import { routing } from '@/i18n/routing'
import { NAV, type NavSection } from '@/lib/navigation'

/**
 * The public header, rendered once by `app/[lang]/(marketing)/layout.tsx`.
 *
 * Before this existed, the home page and the pricing page each carried their
 * own `<nav>`. They drifted: different surfaces (`bg-background/95` vs a
 * hardcoded `bg-white/90`), different heights, and only one of them was ever
 * wrapped in a `<header>` landmark. This file is the single answer, so the
 * ~17 Phase 2 pages inherit a decision rather than copying a snapshot.
 *
 * `bg-background/95` is home's value, kept deliberately: pricing's `/90` was
 * collateral from a dark-mode contrast fix, and home is the older and far more
 * widely seen surface.
 */

/** Sections that render as grouped disclosures, in header order. */
const GROUPED_SECTIONS: NavSection[] = ['platform', 'solutions', 'company']

/** locale -> the `nav.*` key holding its own endonym. */
const LOCALE_LABEL_KEY: Record<string, string> = { en: 'en', 'zh-HK': 'zh' }

/**
 * Swap the locale segment while keeping the rest of the path.
 *
 * `/zh-HK/pricing` -> `/en/pricing`, never `/en`. A switcher that drops the
 * reader at the root loses their place and gives them no clue why.
 */
export function swapLocale(pathname: string, current: string, target: string): string {
  const prefix = `/${current}`
  const rest = pathname === prefix || pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : ''
  return `/${target}${rest}`
}

export function SiteHeader() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname() ?? `/${locale}`

  // Only `available` entries are ever built into the tree. An unavailable
  // entry is absent from the DOM, not hidden with CSS — a hidden 404 is still
  // a 404 to anything that reads the markup rather than the pixels.
  const available = NAV.filter((entry) => entry.available)
  const topEntries = available.filter((entry) => entry.section === 'top')
  const groups = GROUPED_SECTIONS.map((section) => ({
    section,
    entries: available.filter((entry) => entry.section === section),
  })).filter((group) => group.entries.length > 0)

  // Deliberately carries NO display utility. It used to begin with
  // `inline-flex`, which silently defeated every responsive `hidden` at the
  // call sites below: `hidden ${linkClass} sm:inline-flex` emits both `hidden`
  // and `inline-flex`, they have equal specificity, and Tailwind's source order
  // makes `inline-flex` win. The links marked hidden therefore rendered at
  // every width, producing a 196px nav and 117px of horizontal overflow on
  // every marketing page at 375px.
  //
  // Each call site now states its own display, so `hidden` has nothing to lose
  // to. Keep it that way: a display utility here is invisible at desktop width
  // and only shows up as overflow on mobile.
  const linkClass =
    'min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

  return (
    <>
      <a
        href="#main"
        className="sr-only fixed left-4 top-4 z-[60] rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-lg focus:not-sr-only focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('skip_to_main')}
      </a>

      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href={`/${locale}`}
            className="flex min-h-11 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary shadow-sm">
              <Zap aria-hidden="true" className="size-4 text-primary-foreground" />
            </span>
            <span className="font-black tracking-tight">
              {t('brand_name')} <span className="text-primary">{t('brand_product')}</span>
            </span>
          </Link>

          <div className="flex items-center gap-1 sm:gap-3">
            <nav aria-label={t('primary_label')} className="flex items-center gap-1 sm:gap-3">
              {topEntries.map((entry) => (
                <Link
                  key={entry.href}
                  href={entry.href === '/' ? `/${locale}` : `/${locale}${entry.href}`}
                  className={`hidden ${linkClass} sm:inline-flex`}
                >
                  {t(entry.labelKey.replace(/^nav\./, ''))}
                </Link>
              ))}

              {/*
                Every grouped section is empty today, so nothing below renders.
                It is built anyway because the alternative — designing the
                dropdown in the slice that first fills it — makes that slice
                responsible for the header's shape as well as its own content.
                A native <details> keeps it keyboard-operable with no ARIA
                plumbing to get wrong while it is still unexercised.
              */}
              {groups.map(({ section, entries }) => (
                <details key={section} className="group relative hidden lg:block">
                  <summary
                    className={`inline-flex ${linkClass} cursor-pointer list-none marker:content-none`}
                  >
                    {t(`sections.${section}`)}
                  </summary>
                  <ul className="absolute left-0 top-full z-50 mt-1 min-w-56 rounded-xl border border-border bg-card p-2 shadow-lg">
                    {entries.map((entry) => (
                      <li key={entry.href}>
                        <Link href={`/${locale}${entry.href}`} className={`inline-flex w-full ${linkClass}`}>
                          {t(entry.labelKey.replace(/^nav\./, ''))}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}

              <Link href={`/${locale}/auth/login`} className={`hidden ${linkClass} md:inline-flex`}>
                {t('sign_in')}
              </Link>
            </nav>

            {/*
              Real links, not a <select>: the alternate URL has to be crawlable
              and has to agree with the hreflang alternates lib/seo.ts emits.
            */}
            <nav aria-label={t('locale_label')} className="flex items-center">
              <ul className="flex items-center">
                {routing.locales.map((target) => {
                  const isCurrent = target === locale
                  return (
                    <li key={target}>
                      <Link
                        href={swapLocale(pathname, locale, target)}
                        hrefLang={target}
                        aria-current={isCurrent ? 'true' : undefined}
                        className={`inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                          isCurrent ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t(LOCALE_LABEL_KEY[target] ?? 'en')}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>

            {/*
              Home's CTA was the in-page anchor `#scan`. Kept, but absolutised
              to the home page, so it means the same thing from every page in
              the shell instead of silently doing nothing off /.
            */}
            <Link
              href={`/${locale}#scan`}
              className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('get_started')}
            </Link>
          </div>
        </div>
      </header>
    </>
  )
}
