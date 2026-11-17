'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

export type StudioSectionView = 'threads' | 'weekly' | 'documents' | 'connections' | 'tools'

type TabLabelKey = 'threadsTitle' | 'nav.weekly' | 'nav.documents' | 'nav.connections' | 'nav.tools'

const TABS: { view: StudioSectionView; labelKey: TabLabelKey; path: string }[] = [
  { view: 'threads', labelKey: 'threadsTitle', path: 'threads' },
  { view: 'weekly', labelKey: 'nav.weekly', path: 'weekly' },
  { view: 'documents', labelKey: 'nav.documents', path: 'documents' },
  { view: 'connections', labelKey: 'nav.connections', path: 'connections' },
  { view: 'tools', labelKey: 'nav.tools', path: 'tools' },
]

/**
 * Shared page header for the five Chat sections.
 *
 * The section links exist only in the SME copilot layout, where the old Studio rail is
 * absent. Passing `showTabs` from the server keeps the legacy rail from being duplicated.
 */
export function StudioSectionHeader({ clientId, active, title, description, action, showTabs = false }: {
  clientId: string
  active: StudioSectionView
  title: string
  description: string
  action?: ReactNode
  showTabs?: boolean
}) {
  const t = useTranslations('conversationStudio')
  const lang = useLocale()
  const base = `/${lang}/dashboard/${clientId}/studio`
  return <header className="space-y-4">
    <Link href={base} className="as-link inline-flex min-h-11 items-center gap-1"><ArrowLeft className="size-4" aria-hidden="true" />{t('sections.backToChat')}</Link>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1"><h1>{title}</h1><p className="as-muted max-w-[65ch]">{description}</p></div>
      {action}
    </div>
    {showTabs && <nav aria-label={t('sections.label')} tabIndex={0} className="relative overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <ul className="flex w-max gap-1 py-1">
        {TABS.map(tab => {
          const current = tab.view === active
          return <li key={tab.view}><Link
            href={`${base}/${tab.path}`}
            aria-current={current ? 'page' : undefined}
            className={current
              ? 'as-tab-active inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              : 'as-tab-idle inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'}
          >{t(tab.labelKey)}</Link></li>
        })}
      </ul>
    </nav>}
  </header>
}
