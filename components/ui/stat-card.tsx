import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Sparkline } from '@/components/visuals/Sparkline'

export interface StatCardProps {
  label: string
  /** Already formatted for display. */
  value: ReactNode
  /** Change since the previous period; sign decides the arrow. */
  delta?: number | null
  /** Formatted |delta|, e.g. "4 pts". Defaults to the number. */
  deltaText?: string
  /** For metrics where down is good (e.g. failing checks). */
  invertDelta?: boolean
  trend?: readonly number[]
  href?: string
  className?: string
  /** Tighter padding and number size below `sm`; desktop stays unchanged. */
  compactOnMobile?: boolean
}

/**
 * One number, its direction and its recent trend. The delta is arrow + sign +
 * colour, and its full sentence is in the accessible name.
 */
export function StatCard({ label, value, delta, deltaText, invertDelta, trend, href, className, compactOnMobile }: StatCardProps) {
  const t = useTranslations('visuals')
  const direction = delta == null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const good = direction === 'flat' || direction == null ? null : (direction === 'up') !== Boolean(invertDelta)
  const Arrow = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight
  const change = deltaText ?? (delta == null ? '' : String(Math.abs(delta)))

  const body = (
    <>
      <span className={cn('font-medium text-muted-foreground', compactOnMobile ? 'text-xs sm:text-sm' : 'text-sm')}>{label}</span>
      <div className={cn('flex items-end justify-between', compactOnMobile ? 'gap-2 sm:gap-3' : 'gap-3')}>
        <span className={cn('font-black tabular-nums leading-none text-foreground', compactOnMobile ? 'text-2xl sm:text-3xl' : 'text-3xl')}>{value}</span>
        {trend && trend.length > 1 && <Sparkline points={trend} label={label} />}
      </div>
      {direction && (
        <span className={cn(
          'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
          good === null ? 'bg-neutral-3 text-neutral-11' : good ? 'bg-tone-success-soft text-tone-success-fg' : 'bg-tone-danger-soft text-tone-danger-fg',
        )}>
          <Arrow aria-hidden="true" className="size-3.5" />
          <span aria-hidden="true">{direction === 'flat' ? t('statCard.noChange') : `${direction === 'up' ? '+' : '−'}${change}`}</span>
          <span className="sr-only">{t('delta', { direction, change })}</span>
        </span>
      )}
    </>
  )

  const classes = cn(
    'flex flex-col rounded-xl border border-border bg-card shadow-e1',
    compactOnMobile ? 'gap-2 p-3 sm:gap-3 sm:p-5' : 'gap-3 p-5',
    className,
  )
  return href
    ? <Link href={href} className={cn(classes, 'card-interactive')}>{body}</Link>
    : <div className={classes}>{body}</div>
}
