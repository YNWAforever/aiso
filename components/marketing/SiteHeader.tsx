'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { Menu, Zap } from 'lucide-react'
import { routing } from '@/i18n/routing'
import { NAV, type NavSection } from '@/lib/navigation'

const GROUPED_SECTIONS: NavSection[] = ['platform', 'solutions', 'company']
const LOCALE_LABEL_KEY: Record<string, string> = { en: 'en', 'zh-HK': 'zh' }

export function swapLocale(pathname: string, current: string, target: string): string {
  const prefix = `/${current}`
  const rest = pathname === prefix || pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : ''
  return `/${target}${rest}`
}

export function SiteHeader() {
  const locale = useLocale()
  const pathname = usePathname() ?? `/${locale}`
  return <SiteHeaderNavigation key={pathname} pathname={pathname} />
}

function SiteHeaderNavigation({ pathname }: { pathname: string }) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const [openPath, setOpenPath] = useState<string | null>(null)
  const mobileOpen = openPath === pathname
  const trigger = useRef<HTMLButtonElement>(null)
  const header = useRef<HTMLElement>(null)
  const available = NAV.filter(entry => entry.available)
  const topEntries = available.filter(entry => entry.section === 'top')
  const groups = GROUPED_SECTIONS.map(section => ({section, entries: available.filter(entry => entry.section === section)})).filter(group => group.entries.length)
  const href = (path: string) => path === '/' ? `/${locale}` : `/${locale}${path}`
  const current = (path: string) => pathname.replace(/\/$/, '') === href(path) ? 'page' as const : undefined
  const linkClass = 'min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
  const closeDetails = () => header.current?.querySelectorAll('details[open]').forEach(details => details.removeAttribute('open'))

  return <>
    <a href="#main" className="sr-only fixed left-4 top-4 z-[60] rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground focus:not-sr-only">{t('skip_to_main')}</a>
    <header ref={header} className="sticky top-0 z-50 border-b border-border/80 bg-background/95 backdrop-blur-md" onKeyDown={event => {
      if (event.key !== 'Escape') return
      if (mobileOpen) { setOpenPath(null); trigger.current?.focus() }
      const details = (event.target as HTMLElement).closest('details')
      if (details?.open) { details.open = false; details.querySelector('summary')?.focus() }
    }} onClick={event => {
      if ((event.target as HTMLElement).closest('a')) { setOpenPath(null); closeDetails() }
    }}>
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2 sm:px-6">
        <Link href={`/${locale}`} className="flex min-h-11 items-center gap-2 rounded-lg font-black tracking-tight">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary"><Zap aria-hidden="true" className="size-4 text-primary-foreground" /></span>
          <span>{t('brand_name')} <span className="text-primary">{t('brand_product')}</span></span>
        </Link>
        <nav aria-label={t('primary_label')} className="hidden items-center xl:flex">
          {topEntries.map(entry => <Link key={entry.href} href={href(entry.href)} aria-current={current(entry.href)} className={`inline-flex ${linkClass}`}>{t(entry.labelKey.replace(/^nav\./, ''))}</Link>)}
          {groups.map(({section, entries}) => <details key={section} className="group relative" onToggle={event => {
            if (event.currentTarget.open) header.current?.querySelectorAll('details[open]').forEach(other => { if (other !== event.currentTarget) other.removeAttribute('open') })
          }}>
            <summary className={`inline-flex cursor-pointer list-none ${linkClass}`}>{t(`sections.${section}`)}</summary>
            <ul className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-lg">{entries.map(entry => <li key={entry.href}><Link href={href(entry.href)} aria-current={current(entry.href)} className={`inline-flex w-full ${linkClass}`}>{t(entry.labelKey.replace(/^nav\./, ''))}</Link></li>)}</ul>
          </details>)}
          <Link href={`/${locale}/auth/login`} className={`inline-flex ${linkClass}`}>{t('sign_in')}</Link>
        </nav>
        <div className="flex items-center gap-1">
          <nav aria-label={t('locale_label')}><ul className="flex">{routing.locales.map(target => <li key={target}><Link href={swapLocale(pathname,locale,target)} hrefLang={target} aria-current={target===locale?'true':undefined} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-semibold">{t(LOCALE_LABEL_KEY[target] ?? 'en')}</Link></li>)}</ul></nav>
          <Link href={`/${locale}#scan`} className="hidden min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground sm:inline-flex">{t('get_started')}</Link>
          <button ref={trigger} type="button" aria-label={t('menu')} aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={() => setOpenPath(mobileOpen?null:pathname)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border xl:hidden"><Menu aria-hidden="true" className="size-5" /></button>
        </div>
      </div>
      <nav id="mobile-navigation" aria-label={t('primary_label')} hidden={!mobileOpen} className="max-h-[75vh] overflow-y-auto border-t border-border px-4 py-4 xl:hidden">
        <ul className="flex flex-wrap">{topEntries.map(entry => <li key={entry.href}><Link href={href(entry.href)} aria-current={current(entry.href)} className={`inline-flex ${linkClass}`}>{t(entry.labelKey.replace(/^nav\./, ''))}</Link></li>)}<li><Link href={`/${locale}/auth/login`} className={`inline-flex ${linkClass}`}>{t('sign_in')}</Link></li><li><Link href={`/${locale}#scan`} className={`inline-flex ${linkClass}`}>{t('get_started')}</Link></li></ul>
        <div className="grid gap-5 sm:grid-cols-3">{groups.map(({section,entries}) => <section key={section} aria-labelledby={`mobile-${section}`}><h2 id={`mobile-${section}`} className="mt-4 px-3 font-semibold">{t(`sections.${section}`)}</h2><ul>{entries.map(entry=><li key={entry.href}><Link href={href(entry.href)} aria-current={current(entry.href)} className={`inline-flex ${linkClass}`}>{t(entry.labelKey.replace(/^nav\./, ''))}</Link></li>)}</ul></section>)}</div>
      </nav>
    </header>
  </>
}
