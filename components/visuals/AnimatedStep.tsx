'use client'
import { useRef, type ReactNode } from 'react'
import { m, useInView } from 'motion/react'
import { cn } from '@/lib/utils'
import { DURATION, EASE, MAX_STAGGER_TOTAL, transition, variants } from '@/lib/motion'
import { MotionRoot } from '@/components/visuals/MotionRoot'

export interface StepItem {
  /** A rendered icon element (e.g. `<Search />`), so server components can pass it. */
  icon: ReactNode
  title: string
  description?: string
}

export interface AnimatedStepProps extends StepItem {
  index: number
  className?: string
}

/** A numbered step: icon in a circle, a title, at most one line under it. */
export function AnimatedStep({ index, icon, title, description, className }: AnimatedStepProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 text-center', className)}>
      <span className="relative flex size-14 items-center justify-center rounded-full border border-border bg-card text-primary shadow-e1 [&_svg]:size-6">
        <span aria-hidden="true">{icon}</span>
        <span aria-hidden="true" className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span>
      </span>
      <span className="text-base font-bold text-foreground">{title}</span>
      {description && <span className="max-w-[16rem] text-sm text-muted-foreground">{description}</span>}
    </div>
  )
}

export interface AnimatedStepsProps {
  steps: readonly StepItem[]
  /** Accessible name for the list, e.g. "How it works". */
  label: string
  animate?: boolean
  className?: string
}

/**
 * Steps joined by a line that draws as the row scrolls into view: across on
 * wide screens, downward on phones. The line is a scaled bar, not a resized one.
 */
export function AnimatedSteps(props: AnimatedStepsProps) {
  return <MotionRoot><AnimatedStepsInner {...props} /></MotionRoot>
}

function AnimatedStepsInner({ steps, label, animate = true, className }: AnimatedStepsProps) {
  const ref = useRef<HTMLOListElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const shown = !animate || inView
  const lineTransition = { duration: DURATION.count, ease: EASE }
  // Steps land in sequence with the line, the whole group inside 400 ms.
  const stepDelay = steps.length > 1 ? Math.min(0.16, MAX_STAGGER_TOTAL / (steps.length - 1)) : 0

  return (
    <ol ref={ref} aria-label={label} className={cn('relative grid grid-cols-1 gap-8 sm:auto-cols-fr sm:grid-flow-col sm:gap-4', className)}>
      <m.span
        aria-hidden="true"
        className="absolute left-1/2 top-7 bottom-7 w-0.5 origin-top -translate-x-1/2 bg-border sm:hidden"
        initial={animate ? { scaleY: 0 } : false}
        animate={{ scaleY: shown ? 1 : 0 }}
        transition={lineTransition}
      />
      <m.span
        aria-hidden="true"
        className="absolute top-7 hidden h-0.5 origin-left bg-border sm:block"
        style={{ left: `${50 / steps.length}%`, right: `${50 / steps.length}%` }}
        initial={animate ? { scaleX: 0 } : false}
        animate={{ scaleX: shown ? 1 : 0 }}
        transition={lineTransition}
      />
      {steps.map((step, i) => (
        <m.li
          key={step.title}
          className="relative"
          variants={variants.fadeUp}
          initial={animate ? 'hidden' : false}
          animate={shown ? 'visible' : 'hidden'}
          transition={transition(DURATION.enter, i * stepDelay)}
        >
          <AnimatedStep index={i} {...step} />
        </m.li>
      ))}
    </ol>
  )
}
