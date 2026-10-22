'use client'
import { useRef } from 'react'
import { m, useInView } from 'motion/react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { DURATION, EASE } from '@/lib/motion'
import { formatScanScore } from '@/lib/score-display'
import { MotionRoot, useReducedMotion } from '@/components/visuals/MotionRoot'

export interface PotentialScoreBarProps {
  current: number
  /** Projected score once the top fixes are done. Clamped to [current, 100]. */
  potential: number
  animate?: boolean
  className?: string
}

/**
 * Today's score against what the top fixes could reach. Both segments grow by
 * scaleX from the left, so nothing reflows while they animate.
 */
export function PotentialScoreBar(props: PotentialScoreBarProps) {
  return <MotionRoot><PotentialScoreBarInner {...props} /></MotionRoot>
}

function PotentialScoreBarInner({ current, potential, animate = true, className }: PotentialScoreBarProps) {
  const t = useTranslations('visuals')
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const reduced = useReducedMotion()
  const now = Math.min(100, Math.max(0, current))
  const next = Math.min(100, Math.max(now, potential))
  const drawn = !animate || reduced || inView
  const label = t('potentialBar.label', { current: formatScanScore(now), potential: formatScanScore(next) })

  return (
    <div ref={ref} className={cn('flex flex-col gap-2', className)} data-testid="potential-score-bar">
      <div role="img" aria-label={label} className="relative h-3 overflow-hidden rounded-full bg-neutral-4">
        <m.div
          className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-tone-success/35 [background-image:repeating-linear-gradient(45deg,transparent_0_4px,rgb(255_255_255/0.35)_4px_8px)]"
          initial={animate ? { scaleX: 0 } : false}
          animate={{ scaleX: drawn ? next / 100 : 0 }}
          transition={{ duration: DURATION.count, ease: EASE, delay: animate ? 0.3 : 0 }}
        />
        <m.div
          className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-primary"
          initial={animate ? { scaleX: 0 } : false}
          animate={{ scaleX: drawn ? now / 100 : 0 }}
          transition={{ duration: DURATION.count, ease: EASE }}
        />
      </div>
      <div aria-hidden="true" className="flex items-center justify-between gap-4 text-xs">
        <span className="font-semibold text-foreground">{t('potentialBar.now', { score: formatScanScore(now) })}</span>
        <span className="font-semibold text-tone-success-fg">{t('potentialBar.potential', { score: formatScanScore(next) })}</span>
      </div>
    </div>
  )
}
