import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { revealDelay } from '@/components/visuals/reveal/reveal'

export interface RevealStep { icon: ReactNode; title: string; description?: string }

/**
 * AnimatedSteps without hydration: the connecting line draws (scaleX on wide
 * screens, scaleY on phones) and the steps fade up in sequence, all in CSS.
 */
export function RevealSteps({ steps, label, className }: { steps: readonly RevealStep[]; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn('relative grid grid-cols-1 gap-8 sm:auto-cols-fr sm:grid-flow-col sm:gap-4', className)}>
      <span aria-hidden="true" className="reveal-line-y absolute bottom-7 left-1/2 top-7 w-0.5 -translate-x-1/2 bg-border sm:hidden" />
      <span aria-hidden="true" className="reveal-line-x absolute top-7 hidden h-0.5 bg-border sm:block" style={{ left: `${50 / steps.length}%`, right: `${50 / steps.length}%` }} />
      {steps.map((step, i) => (
        <li key={step.title} className="reveal-up relative" style={revealDelay(i * 4)}>
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="relative flex size-14 items-center justify-center rounded-full border border-border bg-card text-primary shadow-e1 [&_svg]:size-6">
              <span aria-hidden="true">{step.icon}</span>
              <span aria-hidden="true" className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
            </span>
            <span className="text-base font-bold text-foreground">{step.title}</span>
            {step.description && <span className="max-w-[16rem] text-sm text-muted-foreground">{step.description}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}
