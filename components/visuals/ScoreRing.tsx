'use client'
import { useRef } from 'react'
import { m, useInView } from 'motion/react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { DURATION, EASE } from '@/lib/motion'
import { formatScanScore } from '@/lib/score-display'
import { MotionRoot, useCountUp, useReducedMotion } from '@/components/visuals/MotionRoot'
import { TONE_CLASSES, gradeKey, gradeTone } from '@/components/visuals/tone'

const SIZES = {
  sm: { box: 72, stroke: 7, number: 'text-xl', suffix: 'text-[0.75rem]' },
  md: { box: 128, stroke: 10, number: 'text-4xl', suffix: 'text-xs' },
  lg: { box: 176, stroke: 12, number: 'text-display', suffix: 'text-sm' },
} as const

export interface ScoreRingProps {
  /** Persisted 0–100 total. */
  score: number
  grade: string
  /** The previous scan's score; shows a delta chip when present. */
  previous?: number | null
  size?: keyof typeof SIZES
  /** Count up and draw the ring when it scrolls into view. False renders the end state. */
  animate?: boolean
  className?: string
}

/**
 * The score as a ring that fills to its value, the number counting up with it.
 *
 * One `role="img"` with the full sentence as its name; the drawn number is
 * hidden from assistive tech so it is not read twice mid-count.
 */
export function ScoreRing(props: ScoreRingProps) {
  return <MotionRoot><ScoreRingInner {...props} /></MotionRoot>
}

function ScoreRingInner({ score, grade, previous, size = 'md', animate = true, className }: ScoreRingProps) {
  const t = useTranslations('visuals')
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const reduced = useReducedMotion()
  const clamped = Math.min(100, Math.max(0, score))
  const decimals = Number.isInteger(clamped) ? 0 : 2
  const shown = useCountUp(clamped, { enabled: animate, start: inView, decimals })

  const dims = SIZES[size]
  const r = (dims.box - dims.stroke) / 2
  const circ = 2 * Math.PI * r
  const tone = TONE_CLASSES[gradeTone(grade)]
  const finalOffset = circ * (1 - clamped / 100)
  const drawn = !animate || reduced || inView
  const delta = previous == null ? null : Math.round((clamped - previous) * 100) / 100
  const gradeLabel = t(`grade.${gradeKey(grade)}`)
  // role="img" makes its children presentational, so the delta has to be part
  // of the accessible name rather than a separate sr-only node.
  const label = [
    t('scoreRing.label', { score: formatScanScore(clamped), grade, gradeLabel }),
    delta === null ? null : t('delta', { direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat', change: formatScanScore(Math.abs(delta)) }),
  ].filter(Boolean).join('. ')

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={cn('inline-flex flex-col items-center gap-2', className)}
      data-testid="score-ring"
    >
      <div aria-hidden="true" className="relative" style={{ width: dims.box, height: dims.box }}>
        <svg width={dims.box} height={dims.box} className="-rotate-90">
          <circle cx={dims.box / 2} cy={dims.box / 2} r={r} fill="none" strokeWidth={dims.stroke} className="stroke-neutral-4" />
          <m.circle
            cx={dims.box / 2} cy={dims.box / 2} r={r} fill="none" strokeWidth={dims.stroke} strokeLinecap="round"
            className={tone.stroke}
            strokeDasharray={circ}
            initial={animate ? { strokeDashoffset: circ } : false}
            animate={{ strokeDashoffset: drawn ? finalOffset : circ }}
            transition={{ duration: DURATION.count, ease: EASE }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('font-black tabular-nums leading-none text-foreground', dims.number)}>
            {formatScanScore(Math.min(shown, clamped))}
          </span>
          <span className={cn('font-medium text-muted-foreground', dims.suffix)}>{t('scoreRing.outOf')}</span>
        </div>
      </div>
      {delta !== null && delta !== 0 && (
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', delta > 0 ? 'bg-tone-success-soft text-tone-success-fg' : 'bg-tone-danger-soft text-tone-danger-fg')}>
          {delta > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
          {formatScanScore(Math.abs(delta))}
        </span>
      )}
    </div>
  )
}
