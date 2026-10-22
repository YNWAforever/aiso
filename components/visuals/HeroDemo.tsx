import type { CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { HeroLoopToggle } from '@/components/visuals/HeroLoopToggle'

/**
 * The landing-page loop (7.2 s): a URL types itself, a beam sweeps a mock page,
 * the score ring fills, and the AI platforms light up as able to cite you.
 *
 * Pure CSS (app/globals.css, "Hero loop"): it sits above the fold on the
 * landing page, where a motion-driven version cost about 165 KB of script and
 * a full second of mobile LCP. The markup rests in the finished frame; the
 * keyframes run only when motion is welcome, so reduced-motion and no-CSS
 * visitors see the composed end state. Browsers pause it in hidden tabs, and
 * HeroLoopToggle lets anyone pause it (the loop runs longer than 5 s).
 *
 * Decorative: the whole figure is aria-hidden with one sentence for screen
 * readers.
 */

const PLATFORMS = ['chatgpt', 'perplexity', 'googleAi', 'gemini', 'claude'] as const
const RING = { box: 88, stroke: 8 }
const R = (RING.box - RING.stroke) / 2
const CIRC = 2 * Math.PI * R

export interface HeroDemoProps {
  /** The score the ring fills to. */
  score?: number
  className?: string
}

export function HeroDemo({ score = 72, className }: HeroDemoProps) {
  const t = useTranslations('visuals.heroDemo')
  const domain = t('domain')
  const clamped = Math.min(100, Math.max(0, score))
  const ringVars = { '--ring-from': CIRC, '--ring-to': CIRC * (1 - clamped / 100) } as CSSProperties
  // The cover steps once per character over the monospace URL.
  const typeVars = { '--type-steps': Array.from(domain).length, width: `${Array.from(domain).length}ch` } as CSSProperties

  return (
    <div className={cn('hero-loop relative w-full max-w-md', className)} data-testid="hero-demo">
      <p className="sr-only">{t('description', { score: clamped })}</p>
      <HeroLoopToggle />
      <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-border bg-card shadow-e3">
        {/* Browser bar with the URL typing in */}
        <div className="flex items-center gap-2 border-b border-border bg-neutral-2 py-2.5 pl-4 pr-12">
          <span className="flex gap-1">
            {[0, 1, 2].map(i => <span key={i} className="size-2 rounded-full bg-neutral-6" />)}
          </span>
          <span className="flex-1 truncate rounded-md bg-card px-3 py-1 font-mono text-xs text-foreground">
            <span className="relative inline-block max-w-full align-bottom" style={typeVars}>
              {domain}
              <span className="hero-type-cover absolute inset-y-0 -right-px left-0 bg-card" />
            </span>
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
            <span className="hero-beam pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-transparent via-primary/30 to-transparent" />
          </div>

          {/* Score ring */}
          <div className="flex flex-col items-center justify-center gap-1">
            <div className="relative" style={{ width: RING.box, height: RING.box }}>
              <svg width={RING.box} height={RING.box} className="-rotate-90">
                <circle cx={RING.box / 2} cy={RING.box / 2} r={R} fill="none" strokeWidth={RING.stroke} className="stroke-neutral-4" />
                <circle
                  cx={RING.box / 2} cy={RING.box / 2} r={R} fill="none" strokeWidth={RING.stroke} strokeLinecap="round"
                  className="hero-ring stroke-tone-info" strokeDasharray={CIRC} style={ringVars}
                />
              </svg>
              <span className="hero-score absolute inset-0 flex items-center justify-center text-2xl font-black tabular-nums text-foreground">
                {clamped}
              </span>
            </div>
            <span className="text-xs font-medium text-muted-foreground">{t('scoreLabel')}</span>
          </div>
        </div>

        {/* Platforms lighting up; only the dot and the tint animate, the label stays at full contrast. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <span className="text-xs font-semibold text-muted-foreground">{t('canCite')}</span>
          {PLATFORMS.map((platform, i) => (
            <span
              key={platform}
              data-lit={i}
              className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground"
            >
              <span className="hero-lit-tint absolute inset-0 bg-tone-success-soft" />
              <span className="hero-lit-dot relative size-2 rounded-full bg-tone-success" />
              <span className="relative">{t(`platforms.${platform}`)}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
