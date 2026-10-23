'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useParams, usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Check, ChevronDown, ChevronRight, CircleHelp, Search } from 'lucide-react'
import type { CommandItem } from '@/components/ui/command-palette'
import { NotificationBell } from '@/components/dashboard/NotificationBell'
import { MenuButton } from '@/components/dashboard/shell/MenuButton'
import { buildDashboardNav, locateDashboard, type NavFeatures } from '@/lib/dashboard-nav'

// The palette (Radix Dialog) loads on first use, not with every dashboard page.
const CommandPalette = dynamic(() => import('@/components/ui/command-palette').then(m => m.CommandPalette), { ssr: false })

export interface ShellBrand { id: string; name: string; domain: string | null }

interface Props {
  lang: string
  /** The account's active brands; null when the list could not be read. */
  brands: ShellBrand[] | null
  unreadCount: number | null
  features: NavFeatures
}

/**
 * The dashboard's top bar: brand switcher and breadcrumbs on the left; search
 * (⌘K), notifications and help on the right. Everything is derived from the
 * route and lib/dashboard-nav.ts, so it always agrees with the sidebar.
 */
export function TopBar({ lang, brands, unreadCount, features }: Props) {
  const t = useTranslations('dashboard')
  const shell = useTranslations('dashboard.shell')
  const ui = useTranslations('ui')
  const params = useParams<{ lang: string; clientId?: string }>()
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const clientId = params?.clientId ?? null
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Until the palette has loaded, ⌘K / Ctrl+K is caught here; afterwards the
  // palette's own listener owns the shortcut, so it is never toggled twice.
  const [paletteLoaded, setPaletteLoaded] = useState(false)
  useEffect(() => {
    if (paletteLoaded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setPaletteLoaded(true)
        setPaletteOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [paletteLoaded])
  const nav = buildDashboardNav({ lang, clientId, features })
  const here = locateDashboard(pathname, clientId ? (searchParams?.get('step') ?? 'home') : null)
  const brand = clientId ? brands?.find(b => b.id === clientId) ?? null : null
  const root = `/${lang}/dashboard`

  // Brands › Brand › Section › Page. The last crumb is the current page.
  const crumbs: { label: string; href: string }[] = [{ label: shell('brands'), href: root }]
  if (clientId) crumbs.push({ label: brand?.name ?? shell('brands'), href: `${root}/${clientId}?step=home` })
  // Resolve against every section, so a hidden one's pages (Monitor's question
  // bank, observations, …) still get a trail; the hidden section itself gets no
  // crumb, because a link to it would advertise it.
  const section = buildDashboardNav({ lang, clientId, features, includeHidden: true }).find(s => s.key === here.section)
  const sectionHidden = !!section && !nav.some(s => s.key === section.key)
  if (section && !(section.key === 'overview' && !here.item)) {
    if (!sectionHidden) crumbs.push({ label: t(section.labelKey), href: section.href })
    const item = section.items.find(i => i.key === here.item)
    if (item && item.href !== section.href) crumbs.push({ label: t(item.labelKey), href: item.href })
    if (here.item === 'roi') crumbs.push({ label: t('local_visibility'), href: `${root}/${clientId}?step=roi` })
  }
  if (!clientId && here.section === 'overview') crumbs.splice(1)

  const commands = useMemo<CommandItem[]>(() => [
    ...nav.flatMap(s => [
      { id: `section-${s.key}`, label: t(s.labelKey), group: shell('group_go'), href: s.href },
      ...s.items.filter(i => i.href !== s.href).map(i => ({ id: `item-${s.key}-${i.key}`, label: `${t(s.labelKey)} › ${t(i.labelKey)}`, group: shell('group_go'), href: i.href })),
    ]),
    ...(brands ?? []).map(b => ({ id: `brand-${b.id}`, label: b.name, keywords: b.domain ? [b.domain] : [], group: shell('group_brands'), href: `${root}/${b.id}?step=home` })),
    { id: 'action-scan', label: shell('action_scan'), group: shell('group_actions'), href: clientId ? `${root}/${clientId}?step=scan` : `/${lang}#scan` },
    ...(clientId ? [{ id: 'action-report', label: shell('action_report'), group: shell('group_actions'), href: `${root}/${clientId}/reports/new` }] : []),
  ], [nav, brands, clientId, lang, root, shell, t])

  return (
    <header className="print:hidden flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2 sm:px-6">
      {clientId && (
        <MenuButton
          label={shell('brand_menu', { name: brand?.name ?? clientId })}
          button={<><span className="max-w-[12rem] truncate">{brand?.name ?? shell('switch_brand')}</span><ChevronDown aria-hidden="true" className="size-4 shrink-0" /></>}
        >
          {close => (
            <div className="flex flex-col">
              <p className="px-2 pb-1 pt-1.5 text-xs font-semibold text-muted-foreground">{shell('switch_brand')}</p>
              {brands === null && <p className="px-2 py-2 text-sm text-muted-foreground">{shell('brands_unavailable')}</p>}
              <ul className="max-h-72 overflow-y-auto">
                {(brands ?? []).map(b => (
                  <li key={b.id}>
                    <Link
                      href={`${root}/${b.id}?step=home`}
                      onClick={close}
                      aria-current={b.id === clientId ? 'true' : undefined}
                      className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm text-foreground hover:bg-secondary"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{b.name}</span>
                        {b.domain && <span className="block truncate text-xs text-muted-foreground">{b.domain}</span>}
                      </span>
                      {b.id === clientId && <Check aria-hidden="true" className="size-4 shrink-0 text-primary-accessible" />}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={root} onClick={close} className="mt-1 flex min-h-10 items-center rounded-lg border-t border-border px-2 text-sm font-semibold text-foreground hover:bg-secondary">
                {shell('all_brands')}
              </Link>
            </div>
          )}
        </MenuButton>
      )}

      <nav aria-label={ui('breadcrumbs')} className="hidden min-w-0 flex-1 md:block">
        <ol className="flex min-w-0 items-center gap-1 text-sm">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <li key={`${crumb.href}-${index}`} className="flex min-w-0 items-center gap-1">
                {index > 0 && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
                {last
                  ? <span aria-current="page" className="truncate font-semibold text-foreground">{crumb.label}</span>
                  : <Link href={crumb.href} className="truncate text-muted-foreground hover:text-foreground">{crumb.label}</Link>}
              </li>
            )
          })}
        </ol>
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => { setPaletteLoaded(true); setPaletteOpen(true) }}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-2.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className="sr-only sm:not-sr-only">{shell('search')}</span>
          <kbd aria-hidden="true" className="hidden rounded border border-border px-1 text-[11px] font-medium sm:inline">⌘K</kbd>
        </button>
        <NotificationBell key={unreadCount ?? 'unknown'} initialCount={unreadCount} lang={lang} />
        <MenuButton label={shell('help')} align="end" button={<CircleHelp aria-hidden="true" className="size-5" />}>
          {close => (
            <ul className="flex flex-col">
              {[
                { href: `/${lang}/methodology`, label: shell('help_methodology') },
                { href: `/${lang}/sample-report`, label: shell('help_sample') },
                { href: `/${lang}/contact`, label: shell('help_contact') },
              ].map(link => (
                <li key={link.href}>
                  <Link href={link.href} onClick={close} className="flex min-h-10 items-center rounded-lg px-2 text-sm text-foreground hover:bg-secondary">{link.label}</Link>
                </li>
              ))}
              <li className="mt-1 border-t border-border px-2 pb-1 pt-2 text-xs text-muted-foreground">{shell('help_shortcuts')}</li>
            </ul>
          )}
        </MenuButton>
      </div>

      {paletteLoaded && <CommandPalette items={commands} open={paletteOpen} onOpenChange={setPaletteOpen} />}
    </header>
  )
}
