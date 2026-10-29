'use client'

import { useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowUpRight, ChevronDown, Files, Globe2, LayoutGrid, Menu, MessageSquare, Plus, Search, Sparkles, Unplug, X } from 'lucide-react'
import { MenuButton } from '@/components/dashboard/shell/MenuButton'
import { CommandPalette } from '@/components/ui/command-palette'
import { buildStudioTools } from '@/lib/conversation-studio/navigation'
import { buildDashboardNav, type NavFeatures } from '@/lib/dashboard-nav'
import { useStudioSession } from '@/components/dashboard/StudioSession'
import './conversation-studio.css'

const entries = [{ path: '', key: 'title', Icon: Sparkles }, { path: '/threads', key: 'threadsTitle', Icon: MessageSquare },
  { path: '/documents', key: 'nav.documents', Icon: Files }, { path: '/connections', key: 'nav.connections', Icon: Unplug }, { path: '/tools', key: 'nav.tools', Icon: LayoutGrid }] as const

export function StudioShell({ children, clientId, brandName, brands, features, admin }: {
  children: ReactNode; clientId: string; brandName: string; brands: { id: string; name: string }[] | null; features: NavFeatures; admin: boolean
}) {
  const t = useTranslations('conversationStudio')
  const dashboard = useTranslations('dashboard')
  const ui = useTranslations('ui')
  const lang = useLocale()
  const otherLang = lang === 'en' ? 'zh-HK' : 'en'
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const base = `/${lang}/dashboard/${clientId}/studio`
  const session = useStudioSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const menu = useRef<HTMLButtonElement>(null)
  const current = entries.find(entry => pathname === base + entry.path) ?? entries[0]
  const discussion = pathname === base && session.activeId !== null
  function closeMenu() { setMenuOpen(false) }
  function goHome(fresh = false) {
    session.setActiveId(null)
    if (fresh) { session.setNewDraft(''); session.setNewTemplate(null) }
    closeMenu()
    if (pathname !== base) router.push(base)
  }
  function openThread(id: number) { session.setActiveId(id); closeMenu(); if (pathname !== base) router.push(base) }
  const tools = buildStudioTools({ lang, clientId, features, admin })
  const commands = [
    ...entries.map(entry => ({ id: `studio${entry.path}`, label: t(entry.key), href: base + entry.path, ...(!entry.path ? { onSelect: () => goHome() } : {}) })),
    { id: 'studio-new', label: t('newThread'), onSelect: () => goHome(true) },
    ...(brands ?? []).map(brand => ({ id: `brand-${brand.id}`, label: brand.name, href: `/${lang}/dashboard/${brand.id}/studio`, ...(brand.id === clientId ? { onSelect: () => goHome() } : {}) })),
    ...buildDashboardNav({ lang, clientId, features }).flatMap(section => [
      { id: section.key, label: dashboard(section.labelKey), href: section.href },
      ...section.items.filter(item => item.href !== section.href).map(item => ({ id: `${section.key}-${item.key}`, label: dashboard(item.labelKey), href: item.href })),
    ]),
    ...tools.filter(tool => tool.key === 'admin').map(tool => ({ id: tool.key, label: dashboard(tool.labelKey), href: tool.href })),
  ]
  return <div id="aiso-studio" className="as-shell" onKeyDown={event => {
    if (event.key === 'Escape' && menuOpen) { closeMenu(); menu.current?.focus() }
  }}>
    <nav className="as-mobile-bar" aria-label={t('sidebarLabel')}>
      <button ref={menu} type="button" className="as-button px-3" aria-label={t(menuOpen ? 'closeNavigation' : 'openNavigation')} aria-expanded={menuOpen} aria-controls="studio-sidebar" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button>
      <span className="font-semibold">{brandName}</span>
    </nav>
    <aside id="studio-sidebar" className={`as-sidebar${menuOpen ? ' as-menu-open' : ''}`} aria-label={t('sidebarLabel')}>
      <p className="as-brand-mark">{t('brandMark')} <span>{t('brandAttribution')}</span></p>
      <div className="as-brand-switcher">
        <p className="as-muted as-small">{t('brandLabel')}</p>
        <MenuButton label={t('brandLabel')} button={<><span className="truncate">{brandName}</span><ChevronDown className="size-4 shrink-0" aria-hidden="true" /></>}>
          {close => <ul>{(brands ?? [{ id: clientId, name: brandName }]).map(brand => <li key={brand.id}><Link className="flex min-h-11 items-center px-3" aria-current={brand.id === clientId ? 'true' : undefined} href={`/${lang}/dashboard/${brand.id}/studio`} onClick={() => { if (brand.id === clientId) goHome(); close(); closeMenu() }}>{brand.name}</Link></li>)}</ul>}
        </MenuButton>
      </div>
      <button type="button" className="as-button as-primary flex items-center gap-2 px-3 font-semibold" onClick={() => goHome(true)}><Plus className="size-4 shrink-0" aria-hidden="true" />{t('newThread')}</button>
      <nav aria-label={t('mainNavigationLabel')}><ul className="space-y-1">{entries.map(({ path, key, Icon }) => <li key={key}>
        <Link href={base + path} className="as-nav-link" aria-current={current.key === key ? 'page' : undefined} onClick={() => { if (!path) session.setActiveId(null); closeMenu() }}><Icon className="size-4 shrink-0" aria-hidden="true" />{t(key)}</Link>
      </li>)}</ul></nav>
      <section className="as-recent space-y-2" aria-labelledby="studio-recent-title">
        <h2 id="studio-recent-title">{t('recentThreadsTitle')}</h2>
        <p className="as-muted as-small">{t('temporaryLabel')}</p>
        {session.threads.length ? <ul>{session.threads.slice(0, 4).map(thread => <li key={thread.id}><button type="button" className="as-thread w-full px-2 text-left" aria-pressed={discussion && session.activeId === thread.id} onClick={() => openThread(thread.id)}><span className="block truncate">{thread.title}</span><span className="as-muted as-small">{t('temporaryLabel')}</span></button></li>)}</ul> : <p className="as-muted as-small">{t('recentThreadsEmpty')}</p>}
      </section>
      <footer className="as-sidefoot as-muted as-small space-y-2"><p>{t('sidebarScope')} · {t('sidebarFlow')}</p><Link href={`/${lang}/dashboard/${clientId}?step=home`} className="flex items-center gap-2 underline">{t('backToDashboard')}<ArrowUpRight className="size-4" aria-hidden="true" /></Link></footer>
    </aside>
    <div className="as-main">
      <header className="as-topbar">
        <nav aria-label={ui('breadcrumbs')} className="as-breadcrumb"><Link href={base} onClick={() => session.setActiveId(null)}>{brandName}</Link><span aria-hidden="true">/</span><span aria-current="page">{t(discussion ? 'discussionTitle' : current.key)}</span></nav>
        <div className="flex flex-wrap items-center gap-2">
          <span className="as-locale"><Globe2 className="size-3.5" aria-hidden="true" />{t('localeLabel')}</span>
          <button type="button" className="as-button inline-flex items-center gap-2 px-3" onClick={() => setPaletteOpen(true)} aria-label={dashboard('shell.search')}><Search className="size-4" aria-hidden="true" /><span className="as-small">⌘K</span></button>
          <Link href={pathname.replace(`/${lang}/`, `/${otherLang}/`)} className="as-button inline-flex items-center px-3" hrefLang={otherLang}>{t('otherLanguage')}</Link>
        </div>
      </header>
      {children}
    </div>
    <CommandPalette items={commands} open={paletteOpen} onOpenChange={setPaletteOpen} />
  </div>
}
