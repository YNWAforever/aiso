'use client'
import { useRef } from 'react'
import { m, useInView } from 'motion/react'
import { Check, HelpCircle, Minus, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { DURATION, staggerDelay, transition, variants } from '@/lib/motion'
import { MotionRoot, useReducedMotion } from '@/components/visuals/MotionRoot'
import { PILLARS, TONE_CLASSES, statusTone, type CheckStatus, type Pillar } from '@/components/visuals/tone'

export interface HeatmapCheck {
  key: string
  /** Already-translated check name. */
  label: string
  status: CheckStatus
  bucket: Pillar
}

export interface CheckHeatmapProps {
  checks: readonly HeatmapCheck[]
  /** Makes each tile a button. */
  onSelect?: (key: string) => void
  selectedKey?: string | null
  animate?: boolean
  className?: string
}

const ICONS = { pass: Check, warn: Minus, fail: X, unknown: HelpCircle } as const

/**
 * All checks at a glance: one tile per check, grouped by pillar, coloured and
 * iconed by status (the icon carries the meaning for anyone who cannot rely on
 * colour). With `onSelect`, tiles are buttons that open the check's detail.
 */
export function CheckHeatmap(props: CheckHeatmapProps) {
  return <MotionRoot><CheckHeatmapInner {...props} /></MotionRoot>
}

function CheckHeatmapInner({ checks, onSelect, selectedKey, animate = true, className }: CheckHeatmapProps) {
  const t = useTranslations('visuals')
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.2 })
  // Reduced motion shows the tiles at once rather than waiting for a scroll.
  const reduced = useReducedMotion()
  const shown = !animate || reduced || inView
  const counts = { pass: 0, warn: 0, fail: 0, unknown: 0 }
  for (const check of checks) counts[check.status] += 1
  let index = 0

  return (
    <div ref={ref} className={cn('flex flex-col gap-4', className)} data-testid="check-heatmap">
      <p className="text-sm text-muted-foreground">{t('heatmap.summary', counts)}</p>
      {PILLARS.map(pillar => {
        const group = checks.filter(check => check.bucket === pillar)
        if (!group.length) return null
        return (
          <section key={pillar} aria-label={t(`pillars.${pillar}`)} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-muted-foreground">{t(`pillars.${pillar}`)}</h3>
            <ul className="flex flex-wrap gap-1.5">
              {group.map(check => {
                const Icon = ICONS[check.status]
                const tone = TONE_CLASSES[statusTone(check.status)]
                const name = t('heatmap.tile', { label: check.label, status: t(`status.${check.status}`) })
                const tileClass = cn(
                  'flex size-10 items-center justify-center rounded-md border transition-transform duration-150 motion-reduce:transition-none',
                  tone.soft, tone.fg, tone.border,
                  selectedKey === check.key && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                )
                const delay = staggerDelay(index++, checks.length)
                return (
                  <m.li
                    key={check.key}
                    variants={variants.scaleIn}
                    initial={animate ? 'hidden' : false}
                    animate={shown ? 'visible' : 'hidden'}
                    transition={transition(DURATION.enter, delay)}
                  >
                    {/* A native title, not a Radix tooltip: the heatmap sits on the landing page,
                        and the tooltip's positioning engine cost more JS than the hint is worth.
                        The full name is in aria-label / sr-only text either way. */}
                    {onSelect ? (
                      <button
                        type="button"
                        title={name}
                        aria-label={name}
                        aria-pressed={selectedKey === check.key}
                        onClick={() => onSelect(check.key)}
                        className={cn(tileClass, 'hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
                      >
                        <Icon aria-hidden="true" className="size-4" />
                      </button>
                    ) : (
                      <span className={tileClass} title={name}>
                        <Icon aria-hidden="true" className="size-4" />
                        <span className="sr-only">{name}</span>
                      </span>
                    )}
                  </m.li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
