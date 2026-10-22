'use client'
import { useRef } from 'react'
import { m, useInView } from 'motion/react'
import { BadgeCheck, CircleSlash, Sparkles, User } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { DURATION, transition, variants } from '@/lib/motion'
import { MotionRoot, useReducedMotion } from '@/components/visuals/MotionRoot'

/**
 * The same question asked twice: once to an assistant that cannot cite the
 * site, once to one that can. Clearly labelled as an illustration; the brand
 * and answers are invented, never a recorded AI response.
 */
export function BeforeAfter() {
  return <MotionRoot><BeforeAfterInner /></MotionRoot>
}

function BeforeAfterInner() {
  const t = useTranslations('landing.compare')
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.35 })
  const shown = useReducedMotion() || inView

  return (
    <div ref={ref} className="grid gap-4 md:grid-cols-2">
      {(['before', 'after'] as const).map((side, i) => {
        const cited = side === 'after'
        return (
          <m.figure
            key={side}
            variants={variants.fadeUp}
            initial="hidden"
            animate={shown ? 'visible' : 'hidden'}
            transition={transition(DURATION.enter, i * 0.15)}
            className={cn('flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-e1', cited ? 'border-tone-success/40' : 'border-border')}
          >
            <figcaption className={cn('inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold', cited ? 'bg-tone-success-soft text-tone-success-fg' : 'bg-neutral-3 text-neutral-11')}>
              {cited ? <BadgeCheck aria-hidden="true" className="size-4" /> : <CircleSlash aria-hidden="true" className="size-4" />}
              {t(`${side}_label`)}
            </figcaption>
            <div className="flex items-start gap-2 self-end">
              <p className="max-w-[16rem] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">{t('question')}</p>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-3"><User aria-hidden="true" className="size-4 text-neutral-11" /></span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent"><Sparkles aria-hidden="true" className="size-4 text-accent-foreground" /></span>
              <div className="flex flex-col gap-2 rounded-2xl rounded-tl-sm bg-neutral-3 px-3.5 py-2 text-sm text-foreground">
                <p>{t(`${side}_answer`)}</p>
                {cited && (
                  <m.span
                    variants={variants.scaleIn}
                    initial="hidden"
                    animate={shown ? 'visible' : 'hidden'}
                    transition={transition(DURATION.enter, 0.45)}
                    className="inline-flex w-fit items-center gap-1 rounded-full border border-tone-success/40 bg-card px-2 py-0.5 text-xs font-semibold text-tone-success-fg"
                  >
                    <BadgeCheck aria-hidden="true" className="size-3.5" />{t('source')}
                  </m.span>
                )}
              </div>
            </div>
          </m.figure>
        )
      })}
      <p className="text-xs text-muted-foreground md:col-span-2">{t('illustration')}</p>
    </div>
  )
}
