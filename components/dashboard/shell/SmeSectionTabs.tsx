'use client'

import Link from 'next/link'
import { useParams, usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { smeSectionLabelKey, smeTabState } from '@/lib/sme-tabs'

/**
 * Tab bar for the two consolidated SME destinations (What AI says / Improve).
 *
 * It renders only on paths that belong to one of them: every other dashboard
 * route (Today, Reports, Chat, account pages) returns null and stays untouched.
 * Rendered once by `DashboardChrome`, so the tab URLs need no page changes.
 */
export function SmeSectionTabs() {
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const params = useParams<{ lang?: string; clientId?: string }>()
  const t = useTranslations('smeTabs')
  const lang = typeof params?.lang === 'string' ? params.lang : null
  const clientId = typeof params?.clientId === 'string' ? params.clientId : null
  if (!lang || !clientId) return null
  const prefix = `/${lang}/dashboard/${clientId}`
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null
  const segment = pathname.slice(prefix.length).replace(/^\//, '')
  const state = smeTabState({ base: prefix, segment, step: searchParams.get('step'), accountBase: `/${lang}/dashboard/this-month` })
  if (!state) return null
  return <nav aria-label={t(smeSectionLabelKey(state.section))} className="border-b border-border bg-background">
    <ul className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 py-2 text-sm sm:px-6">
      {state.tabs.map(tab => {
        const active = tab.id === state.active
        return <li key={tab.id}>
          <Link
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={active
              ? 'inline-block whitespace-nowrap rounded-full bg-primary px-3 py-1.5 font-semibold text-primary-foreground no-underline'
              : 'inline-block whitespace-nowrap rounded-full px-3 py-1.5 text-muted-foreground no-underline hover:bg-muted hover:text-foreground'}
          >{t(tab.labelKey)}</Link>
        </li>
      })}
    </ul>
  </nav>
}
