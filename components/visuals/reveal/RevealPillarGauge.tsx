import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { PILLAR_MAX, TONE_CLASSES, type Pillar, type Tone } from '@/components/visuals/tone'

const W = 132
const STROKE = 12
const R = (W - STROKE) / 2
const ARC = Math.PI * R
const H = W / 2 + STROKE / 2
const PATH = `M ${STROKE / 2} ${W / 2} A ${R} ${R} 0 0 1 ${W - STROKE / 2} ${W / 2}`

function toneFor(ratio: number): Tone {
  if (ratio >= 0.8) return 'success'
  if (ratio >= 0.5) return 'warning'
  return 'danger'
}

/**
 * PillarGauge without motion: the half-dial draws with a CSS transition once a
 * `[data-reveal]` ancestor scrolls into view; the points show their final
 * value. Shrinks to its column (up to 132 px) so three fit on a phone.
 */
export function RevealPillarGauge({ pillar, earned, max = PILLAR_MAX[pillar], className }: { pillar: Pillar; earned: number; max?: number; className?: string }) {
  const t = useTranslations('visuals')
  const value = Math.min(max, Math.max(0, earned))
  const ratio = max > 0 ? value / max : 0
  const tone = TONE_CLASSES[toneFor(ratio)]
  const name = t(`pillars.${pillar}`)
  const vars = { ['--ring-from' as string]: ARC, ['--ring-to' as string]: ARC * (1 - ratio) }

  return (
    <div
      role="meter"
      aria-label={name}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={t('pillarGauge.value', { earned: Math.round(value), max })}
      className={cn('flex w-full min-w-0 flex-col items-center gap-1', className)}
      data-testid={`pillar-gauge-${pillar}`}
    >
      <div className="relative w-full" style={{ maxWidth: W, aspectRatio: `${W} / ${H}` }}>
        <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible">
          <path d={PATH} fill="none" strokeWidth={STROKE} strokeLinecap="round" className="stroke-neutral-4" />
          <path d={PATH} fill="none" strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={ARC} className={cn('reveal-ring', tone.stroke)} style={vars} />
        </svg>
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex items-baseline justify-center gap-0.5">
          <span className="text-xl font-black tabular-nums leading-none text-foreground sm:text-2xl">{Math.round(value)}</span>
          <span className="text-xs font-medium text-muted-foreground">/{max}</span>
        </div>
      </div>
      <span className="text-sm font-semibold text-foreground">{name}</span>
    </div>
  )
}
