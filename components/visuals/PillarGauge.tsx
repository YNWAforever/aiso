'use client'
import { useRef } from 'react'
import { m, useInView } from 'motion/react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { DURATION, EASE } from '@/lib/motion'
import { MotionRoot, useCountUp, useReducedMotion } from '@/components/visuals/MotionRoot'
import { PILLAR_MAX, TONE_CLASSES, type Pillar, type Tone } from '@/components/visuals/tone'

export interface PillarGaugeProps {
  pillar: Pillar
  earned: number
  /** Defaults to the pillar's share of the 100-point score. */
  max?: number
  animate?: boolean
  /** Shrink to the column width (up to the normal size), so three fit side by side on a phone. */
  fluid?: boolean
  className?: string
}

function toneFor(ratio: number): Tone {
  if (ratio >= 0.8) return 'success'
  if (ratio >= 0.5) return 'warning'
  return 'danger'
}

const W = 132
const STROKE = 12
const R = (W - STROKE) / 2
const ARC = Math.PI * R
const H = W / 2 + STROKE / 2
const PATH = `M ${STROKE / 2} ${W / 2} A ${R} ${R} 0 0 1 ${W - STROKE / 2} ${W / 2}`

/** One pillar's points as a half-dial: Core, Extended or GEO. */
export function PillarGauge(props: PillarGaugeProps) {
  return <MotionRoot><PillarGaugeInner {...props} /></MotionRoot>
}

function PillarGaugeInner({ pillar, earned, max = PILLAR_MAX[pillar], animate = true, fluid = false, className }: PillarGaugeProps) {
  const t = useTranslations('visuals')
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const reduced = useReducedMotion()
  const value = Math.min(max, Math.max(0, earned))
  const ratio = max > 0 ? value / max : 0
  const shown = useCountUp(Math.round(value), { enabled: animate, start: inView })
  const drawn = !animate || reduced || inView
  const tone = TONE_CLASSES[toneFor(ratio)]
  const name = t(`pillars.${pillar}`)

  return (
    <div
      ref={ref}
      role="meter"
      aria-label={name}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={t('pillarGauge.value', { earned: Math.round(value), max })}
      className={cn('inline-flex flex-col items-center gap-1', fluid && 'w-full min-w-0', className)}
      data-testid={`pillar-gauge-${pillar}`}
    >
      <div className={cn('relative', fluid && 'w-full')} style={fluid ? { maxWidth: W, aspectRatio: `${W} / ${H}` } : { width: W, height: H }}>
        <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} width={fluid ? undefined : W} height={fluid ? undefined : H} className={cn('overflow-visible', fluid && 'h-auto w-full')}>
          <path d={PATH} fill="none" strokeWidth={STROKE} strokeLinecap="round" className="stroke-neutral-4" />
          <m.path
            d={PATH} fill="none" strokeWidth={STROKE} strokeLinecap="round" className={tone.stroke}
            strokeDasharray={ARC}
            initial={animate ? { strokeDashoffset: ARC } : false}
            animate={{ strokeDashoffset: drawn ? ARC * (1 - ratio) : ARC }}
            transition={{ duration: DURATION.count, ease: EASE }}
          />
        </svg>
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex items-baseline justify-center gap-0.5">
          <span className={cn('font-black tabular-nums leading-none text-foreground', fluid ? 'text-xl sm:text-2xl' : 'text-2xl')}>{shown}</span>
          <span className="text-xs font-medium text-muted-foreground">/{max}</span>
        </div>
      </div>
      <span className="text-sm font-semibold text-foreground">{name}</span>
    </div>
  )
}
