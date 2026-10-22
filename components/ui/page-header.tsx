import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export interface Crumb { label: string; href?: string }

export interface PageHeaderProps {
  /** ≤ 8 words (≤ 14 CJK characters). */
  title: string
  /** One line at most; longer explanation belongs in a drawer or "Learn more". */
  description?: string
  actions?: ReactNode
  breadcrumbs?: readonly Crumb[]
  className?: string
}

export function PageHeader({ title, description, actions, breadcrumbs, className }: PageHeaderProps) {
  const t = useTranslations('ui')
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label={t('breadcrumbs')}>
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {breadcrumbs.map((crumb, i) => {
              const last = i === breadcrumbs.length - 1
              return (
                <li key={`${crumb.label}-${i}`} className="inline-flex items-center gap-1">
                  {crumb.href && !last
                    ? <Link href={crumb.href} className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{crumb.label}</Link>
                    : <span aria-current={last ? 'page' : undefined} className={cn(last && 'font-medium text-foreground')}>{crumb.label}</span>}
                  {!last && <ChevronRight aria-hidden="true" className="size-3.5" />}
                </li>
              )
            })}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">{title}</h1>
          {description && <p className="text-sm text-muted-foreground sm:text-base">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
