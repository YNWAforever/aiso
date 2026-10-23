import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Illustration, type IllustrationName } from '@/components/ui/illustration'

export { Illustration, type IllustrationName }

export interface EmptyStateProps {
  illustration?: IllustrationName
  title: string
  /** One line. */
  description?: string
  /** One button. */
  action?: ReactNode
  className?: string
}

/** Illustration, one heading, one line, one action. */
export function EmptyState({ illustration = 'scan', title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center', className)}>
      <Illustration name={illustration} />
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
