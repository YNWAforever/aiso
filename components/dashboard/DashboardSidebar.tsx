'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useParams, usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LogOut, Wrench, Brain, Settings, Lock, LayoutDashboard, MessageSquare, ScanSearch, Radio, FileText, Settings2, type LucideIcon } from 'lucide-react'
import type { CommercialEntitlement } from '@/lib/tier'
import { ThemeToggle } from '@/components/dashboard/ThemeToggle'
import { buildDashboardNav, locateDashboard, type SectionKey } from '@/lib/dashboard-nav'
import { cn } from '@/lib/utils'
import { Wordmark } from '@/components/brand/Wordmark'

const SECTION_ICONS: Record<SectionKey, LucideIcon> = {
  overview: LayoutDashboard, studio: MessageSquare, scan: ScanSearch, monitor: Radio, reports: FileText, settings: Settings2,
}

type Props = {
  profile: {
    display_name?: string | null
    /** Label fallback: profiles are provisioned without a display name. */
    email?: string | null
    is_admin?: boolean
  }
  entitlement: CommercialEntitlement
  /**
   * Optional fallback only. The layout above cannot see the [clientId] segment,
   * so nothing supplies this today — the id comes from useParams below.
   */
  brandId?: string
  /** Evaluated on the server; never read feature env vars in this component. */
  conversationStudio?: boolean
}

/**
 * Five sections (lib/dashboard-nav.ts): Overview, Scan & Fix, Monitor (hidden
 * until Pulse is scheduled), Reports and Settings. The current section opens
 * to show its pages. A missing brand sends brand-only sections to the brand
 * list; a plan limit shows a lock but never blocks the link, because the page
 * itself carries the upgrade path.
 */
export function DashboardSidebar({ profile, entitlement, brandId, conversationStudio = false }: Props) {
  const t = useTranslations('dashboard')
  const [navigationOpen, setNavigationOpen] = useState(false)
  const params = useParams<{ lang: string; clientId?: string; scanId?: string }>()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const lang = params?.lang ?? 'en'
  // Read the brand from the route rather than trusting the prop: a layout cannot
  // see a child segment's params, but this client component renders inside the
  // route, so useParams can.
  const clientId = params?.clientId ?? brandId
  const { plan, features } = entitlement
  const scanId = params?.scanId ?? searchParams?.get('scanId')
  const nav = buildDashboardNav({ lang, clientId, features, scanId, conversationStudio })
  const here = locateDashboard(pathname ?? '', clientId ? (searchParams?.get('step') ?? 'home') : null)

  return (
    <aside className="print:hidden w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-border bg-card flex flex-col md:min-h-full">

      <div className="px-5 py-4 border-b border-border">
        <Link href={`/${lang}/dashboard`} className="flex min-h-11 items-center gap-2.5">
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <Brain className="size-4 text-primary-foreground" aria-hidden="true" />
          </div>
          <Wordmark className="font-black text-foreground text-sm" accentClassName="text-primary-accessible" />
        </Link>
      </div>

      <button type="button" aria-expanded={navigationOpen} aria-controls="workspace-sidebar-navigation" onClick={() => setNavigationOpen(open => !open)} className="mx-3 my-2 min-h-11 rounded-lg border border-border px-3 text-left text-sm font-semibold text-foreground md:hidden">
        {t('toggle_navigation')}
      </button>
      <div id="workspace-sidebar-navigation" className={`${navigationOpen ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col max-h-[60dvh] overflow-y-auto md:max-h-none md:flex`}>
        <nav aria-label={t('workspace_navigation')} className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {nav.map(section => {
            const Icon = SECTION_ICONS[section.key]
            const inSection = here.section === section.key
            // The section page itself is current only when no item of it is.
            const current = inSection && (section.items.length === 0 || here.item === null || section.items.every(item => item.key !== here.item))
            const unreachable = section.needsBrand && !clientId
            return (
              <div key={section.key}>
                <Link
                  href={section.href}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => setNavigationOpen(false)}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-150',
                    inSection ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{t(section.labelKey)}</span>
                    <span className={cn('block truncate text-[11px] leading-tight', inSection ? 'text-primary-foreground' : 'text-muted-foreground')}>
                      {t(unreachable ? 'select_brand_first' : section.descKey)}
                    </span>
                  </span>
                </Link>
                {inSection && section.items.length > 0 && (
                  <ul className="mt-1 mb-2 ml-5 space-y-0.5 border-l border-border pl-3">
                    {section.items.map(item => {
                      const active = here.item === item.key
                      return (
                        <li key={item.key}>
                          <Link
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => setNavigationOpen(false)}
                            className={cn(
                              'flex min-h-9 items-center gap-2 rounded-lg px-2 text-[13px] font-medium transition-colors duration-150',
                              active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                            {item.locked && <Lock className="size-3 shrink-0" aria-label={t('plan_required')} />}
                            {item.badge && <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary-accessible">{item.badge}</span>}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </nav>

        <div className="px-3 pb-2">
          <ThemeToggle />
        </div>

        <div className="px-3 pb-3">
          <div className="rounded-xl border border-border bg-neutral-2 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t('plan_label')}</p>
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-black text-primary-accessible">
                {plan.charAt(0).toUpperCase() + plan.slice(1)}
              </span>
            </div>
            <Link href={`/${lang}/dashboard/settings`} onClick={() => setNavigationOpen(false)}
              className="flex min-h-11 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <Settings className="size-3" aria-hidden="true" /> {t('manage_plan')}
            </Link>
          </div>
        </div>

        <div className="border-t border-border px-3 pb-4 pt-2">
          <div className="flex items-center gap-2 px-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <span className="text-[10px] font-bold text-primary-accessible">
                {(profile.display_name || profile.email || 'U')[0]?.toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium text-foreground">{profile.display_name || profile.email || 'User'}</p>
              <p className="text-[10px] text-muted-foreground">{plan}</p>
            </div>
            {profile.is_admin && (
              <Link href={`/admin?lang=${lang}`} className="inline-flex size-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground" title={t('admin')} aria-label={t('admin')}>
                <Wrench size={13} aria-hidden="true" />
              </Link>
            )}
            <Link href={`/${lang}/auth/logout?next=${encodeURIComponent(`${pathname}${searchParams?.size ? `?${searchParams}` : ''}`)}`} className="inline-flex size-11 items-center justify-center text-muted-foreground transition-colors hover:text-destructive" title={t('sign_out')} aria-label={t('sign_out')}>
              <LogOut size={13} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </aside>
  )
}
