'use client'
import { AnimatePresence, m } from 'motion/react'
import { Check, HelpCircle, Loader2, Minus, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { DURATION, transition, variants } from '@/lib/motion'
import { MotionRoot } from '@/components/visuals/MotionRoot'
import { PILLARS, TONE_CLASSES, statusTone, type CheckStatus, type Pillar } from '@/components/visuals/tone'

export type TimelineStatus = 'pending' | 'running' | CheckStatus

export interface TimelineCheck {
  key: string
  label: string
  bucket: Pillar
  status: TimelineStatus
}

export interface ScanTimelineProps {
  checks: readonly TimelineCheck[]
  /** Running score so far; omitted until the first check settles. */
  score?: number | null
  className?: string
}

const SETTLED_ICONS = { pass: Check, warn: Minus, fail: X, unknown: HelpCircle } as const

/**
 * Live scan progress: every check flips pending → running → result, grouped by
 * the pillar that is running. A polite live region announces progress per
 * pillar rather than per check, so a screen reader is not read twenty updates.
 */
export function ScanTimeline(props: ScanTimelineProps) {
  return <MotionRoot><ScanTimelineInner {...props} /></MotionRoot>
}

function ScanTimelineInner({ checks, score, className }: ScanTimelineProps) {
  const t = useTranslations('visuals')
  const done = checks.filter(c => c.status !== 'pending' && c.status !== 'running').length
  const active = checks.find(c => c.status === 'running')?.bucket ?? checks.find(c => c.status === 'pending')?.bucket ?? null
  const complete = done === checks.length

  return (
    <div className={cn('flex flex-col gap-4', className)} data-testid="scan-timeline">
      <div className="flex items-end justify-between gap-4">
        <p aria-live="polite" className="text-sm font-medium text-foreground">
          {complete
            ? t('scanTimeline.complete', { total: checks.length })
            : t('scanTimeline.progress', { done, total: checks.length, pillar: active ? t(`pillars.${active}`) : '' })}
        </p>
        {score != null && (
          <AnimatePresence mode="popLayout" initial={false}>
            <m.span
              key={Math.round(score)}
              variants={variants.fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={transition(DURATION.ui)}
              className="text-3xl font-black tabular-nums leading-none text-foreground"
              aria-hidden="true"
            >
              {Math.round(score)}
            </m.span>
          </AnimatePresence>
        )}
      </div>
      <ol className="flex flex-col gap-3">
        {PILLARS.map(pillar => {
          const group = checks.filter(c => c.bucket === pillar)
          if (!group.length) return null
          const isActive = pillar === active && !complete
          return (
            <li key={pillar} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-200', isActive ? 'bg-accent' : 'bg-transparent')}>
              <span className={cn('w-20 shrink-0 text-xs font-semibold', isActive ? 'text-accent-foreground' : 'text-muted-foreground')}>
                {t(`pillars.${pillar}`)}
              </span>
              <ul aria-label={t(`pillars.${pillar}`)} className="flex flex-wrap gap-1.5">
                {group.map(check => <TimelineDot key={check.key} check={check} />)}
              </ul>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function TimelineDot({ check }: { check: TimelineCheck }) {
  const t = useTranslations('visuals')
  const settled = check.status !== 'pending' && check.status !== 'running'
  const tone = settled ? TONE_CLASSES[statusTone(check.status as CheckStatus)] : null
  const Icon = settled ? SETTLED_ICONS[check.status as CheckStatus] : check.status === 'running' ? Loader2 : null

  return (
    <li className="relative size-6">
      <span className="sr-only">{t('heatmap.tile', { label: check.label, status: t(`status.${check.status}`) })}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={check.status}
          aria-hidden="true"
          variants={variants.scaleIn}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={transition(DURATION.ui)}
          className={cn(
            'absolute inset-0 flex items-center justify-center rounded-full border',
            tone ? cn(tone.soft, tone.fg, tone.border) : check.status === 'running' ? 'border-primary text-primary' : 'border-neutral-6 bg-neutral-2',
          )}
        >
          {Icon && <Icon className={cn('size-3.5', check.status === 'running' && 'animate-spin motion-reduce:animate-none')} />}
        </m.span>
      </AnimatePresence>
    </li>
  )
}
