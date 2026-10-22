'use client'
import { useEffect, useRef, useState } from 'react'
import { m, useInView } from 'motion/react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { DURATION, EASE, transition } from '@/lib/motion'
import { MotionRoot, useReducedMotion } from '@/components/visuals/MotionRoot'

/**
 * The landing-page loop (7.2 s): a URL types itself, a beam sweeps a mock page,
 * the score ring fills, and the AI platforms light up as able to cite you.
 *
 * Decorative: the whole figure is aria-hidden with one sentence for screen
 * readers. Reduced motion renders the finished frame and never starts the
 * timer; the loop also pauses off-screen and in a hidden tab.
 */

const PHASES = ['type', 'scan', 'score', 'cite', 'hold'] as const
type Phase = (typeof PHASES)[number]
/** Milliseconds each phase lasts; sums to the 7.2 s loop. */
const PHASE_MS: Record<Phase, number> = { type: 1400, scan: 2000, score: 1000, cite: 1800, hold: 1000 }
const PLATFORMS = ['chatgpt', 'perplexity', 'googleAi', 'gemini', 'claude'] as const
const RING = { box: 88, stroke: 8 }
const R = (RING.box - RING.stroke) / 2
const CIRC = 2 * Math.PI * R

export interface HeroDemoProps {
  /** The score the ring fills to. */
  score?: number
  className?: string
}

export function HeroDemo(props: HeroDemoProps) {
  return <MotionRoot><HeroDemoInner {...props} /></MotionRoot>
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

function HeroDemoInner({ score = 72, className }: HeroDemoProps) {
  const t = useTranslations('visuals.heroDemo')
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.3 })
  const pageVisible = usePageVisible()
  const reduced = useReducedMotion()
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [cycle, setCycle] = useState(0)
  const running = inView && pageVisible && !reduced

  // Pausing stops the timer but not animations already in flight, so a resumed
  // phase would replay its full duration over a finished animation. Resuming
  // restarts the loop from the top instead (state adjusted during render, the
  // React-recommended way to react to a changed input without an effect).
  const [wasRunning, setWasRunning] = useState(running)
  if (running !== wasRunning) {
    setWasRunning(running)
    if (running) { setPhaseIndex(0); setCycle(c => c + 1) }
  }

  useEffect(() => {
    if (!running) return
    const timer = setTimeout(() => {
      if (phaseIndex === PHASES.length - 1) { setPhaseIndex(0); setCycle(c => c + 1) }
      else setPhaseIndex(i => i + 1)
    }, PHASE_MS[PHASES[phaseIndex]!])
    return () => clearTimeout(timer)
  }, [running, phaseIndex])

  // Reduced motion shows the composed end state, whatever the timer last did.
  const at = reduced ? PHASES.length - 1 : phaseIndex
  const reached = (phase: Phase) => at >= PHASES.indexOf(phase)
  const domain = t('domain')
  const clamped = Math.min(100, Math.max(0, score))

  return (
    <div ref={ref} className={cn('relative w-full max-w-md', className)} data-testid="hero-demo">
      <p className="sr-only">{t('description', { score: clamped })}</p>
      <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-border bg-card shadow-e3">
        {/* Browser bar with the URL typing in */}
        <div className="flex items-center gap-2 border-b border-border bg-neutral-2 px-4 py-2.5">
          <span className="flex gap-1">
            {[0, 1, 2].map(i => <span key={i} className="size-2 rounded-full bg-neutral-6" />)}
          </span>
          <span key={cycle} className="flex-1 truncate rounded-md bg-card px-3 py-1 font-mono text-xs text-foreground">
            {Array.from(domain).map((char, i) => (
              <m.span
                key={i}
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.01, delay: reduced ? 0 : (i * (PHASE_MS.type / 1000 - 0.3)) / domain.length }}
              >
                {char}
              </m.span>
            ))}
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-4 p-4">
          {/* Mock page with the scanning beam */}
          <div className="relative flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-background p-3">
            <span className="h-3 w-2/3 rounded bg-neutral-5" />
            <span className="h-2 w-full rounded bg-neutral-4" />
            <span className="h-2 w-5/6 rounded bg-neutral-4" />
            <span className="mt-1 h-10 w-full rounded bg-neutral-3" />
            <span className="h-2 w-4/6 rounded bg-neutral-4" />
            <span className="h-2 w-3/6 rounded bg-neutral-4" />
            {!reduced && at === PHASES.indexOf('scan') && (
              <m.span
                key={`beam-${cycle}`}
                className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-transparent via-primary/30 to-transparent"
                initial={{ y: '-100%', opacity: 0 }}
                animate={{ y: '420%', opacity: [0, 1, 1, 0] }}
                transition={{ duration: PHASE_MS.scan / 1000, ease: EASE }}
              />
            )}
          </div>

          {/* Score ring */}
          <div className="flex flex-col items-center justify-center gap-1">
            <div className="relative" style={{ width: RING.box, height: RING.box }}>
              <svg width={RING.box} height={RING.box} className="-rotate-90">
                <circle cx={RING.box / 2} cy={RING.box / 2} r={R} fill="none" strokeWidth={RING.stroke} className="stroke-neutral-4" />
                <m.circle
                  key={`ring-${cycle}`}
                  cx={RING.box / 2} cy={RING.box / 2} r={R} fill="none" strokeWidth={RING.stroke} strokeLinecap="round"
                  className="stroke-tone-info" strokeDasharray={CIRC}
                  initial={reduced ? false : { strokeDashoffset: CIRC }}
                  animate={{ strokeDashoffset: reached('score') ? CIRC * (1 - clamped / 100) : CIRC }}
                  transition={{ duration: DURATION.count, ease: EASE }}
                />
              </svg>
              <m.span
                className="absolute inset-0 flex items-center justify-center text-2xl font-black tabular-nums text-foreground"
                initial={false}
                animate={{ opacity: reached('score') ? 1 : 0 }}
                transition={transition(DURATION.enter)}
              >
                {clamped}
              </m.span>
            </div>
            <span className="text-xs font-medium text-muted-foreground">{t('scoreLabel')}</span>
          </div>
        </div>

        {/* Platforms lighting up */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <span className="text-xs font-semibold text-muted-foreground">{t('canCite')}</span>
          {PLATFORMS.map((platform, i) => {
            const lit = reached('cite')
            // Only the dot lights up; the label stays at full contrast throughout.
            return (
              <span
                key={platform}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-foreground transition-colors duration-200', lit ? 'border-tone-success/40 bg-tone-success-soft' : 'border-border bg-card')}
              >
                <m.span
                  key={`dot-${cycle}`}
                  className="size-2 rounded-full bg-tone-success"
                  initial={false}
                  animate={{ opacity: lit ? 1 : 0.25, scale: lit ? 1 : 0.6 }}
                  transition={transition(DURATION.enter, lit && !reduced ? i * 0.12 : 0)}
                />
                {t(`platforms.${platform}`)}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
