import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type IllustrationName = 'scan' | 'fixes' | 'tasks' | 'reports' | 'error'

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

/**
 * First-pass two-tone spot illustrations. Token colours only, so they follow
 * the theme. Decorative: the heading next to them says what they mean.
 */
export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 88" className={cn('h-20 w-28', className)} fill="none">
      <rect x="10" y="8" width="100" height="72" rx="10" className="fill-neutral-3" />
      {name === 'scan' && (<>
        <rect x="24" y="22" width="52" height="6" rx="3" className="fill-neutral-6" />
        <rect x="24" y="34" width="72" height="4" rx="2" className="fill-neutral-5" />
        <rect x="24" y="44" width="64" height="4" rx="2" className="fill-neutral-5" />
        <circle cx="80" cy="56" r="14" strokeWidth="5" className="stroke-primary" />
        <path d="M90 66l10 10" strokeWidth="5" strokeLinecap="round" className="stroke-primary" />
      </>)}
      {name === 'fixes' && (<>
        <path d="M34 50l10 10 22-26" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" className="stroke-tone-success" />
        <rect x="74" y="28" width="22" height="5" rx="2.5" className="fill-neutral-6" />
        <rect x="74" y="40" width="16" height="5" rx="2.5" className="fill-neutral-5" />
      </>)}
      {name === 'tasks' && [0, 1, 2].map(i => (
        <g key={i}>
          <rect x="24" y={22 + i * 16} width="10" height="10" rx="3" className={i === 0 ? 'fill-primary' : 'fill-neutral-6'} />
          <rect x="40" y={25 + i * 16} width={i === 1 ? 40 : 54} height="4" rx="2" className="fill-neutral-5" />
        </g>
      ))}
      {name === 'reports' && (<>
        <rect x="26" y="52" width="12" height="16" rx="2" className="fill-neutral-6" />
        <rect x="44" y="40" width="12" height="28" rx="2" className="fill-neutral-6" />
        <rect x="62" y="30" width="12" height="38" rx="2" className="fill-primary" />
        <rect x="80" y="44" width="12" height="24" rx="2" className="fill-neutral-6" />
      </>)}
      {name === 'error' && (<>
        <path d="M60 22l26 44H34z" strokeWidth="5" strokeLinejoin="round" className="stroke-tone-warning" />
        <path d="M60 38v12" strokeWidth="5" strokeLinecap="round" className="stroke-tone-warning" />
        <circle cx="60" cy="58" r="3" className="fill-tone-warning" />
      </>)}
    </svg>
  )
}
