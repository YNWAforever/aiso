import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { formatScanScore } from '@/lib/score-display'
import { TONE_CLASSES, gradeKey, gradeTone } from '@/components/visuals/tone'

const SIZES = {
  md: { box: 128, stroke: 10, number: 'text-4xl', suffix: 'text-xs' },
  lg: { box: 176, stroke: 12, number: 'text-display', suffix: 'text-sm' },
} as const

/**
 * ScoreRing for pages that should not hydrate: server-rendered, the ring draws
 * with a CSS transition once a `[data-reveal]` ancestor scrolls into view. The
 * number is shown at its final value (a count-up would need a client script).
 */
export function RevealScoreRing({ score, grade, size = 'md', className }: { score: number; grade: string; size?: keyof typeof SIZES; className?: string }) {
  const t = useTranslations('visuals')
  const clamped = Math.min(100, Math.max(0, score))
  const dims = SIZES[size]
  const r = (dims.box - dims.stroke) / 2
  const circ = 2 * Math.PI * r
  const tone = TONE_CLASSES[gradeTone(grade)]
  const vars = { ['--ring-from' as string]: circ, ['--ring-to' as string]: circ * (1 - clamped / 100) }

  return (
    <div
      role="img"
      aria-label={t('scoreRing.label', { score: formatScanScore(clamped), grade, gradeLabel: t(`grade.${gradeKey(grade)}`) })}
      className={cn('inline-flex flex-col items-center gap-2', className)}
      data-testid="score-ring"
    >
      <div aria-hidden="true" className="relative" style={{ width: dims.box, height: dims.box }}>
        <svg width={dims.box} height={dims.box} className="-rotate-90">
          <circle cx={dims.box / 2} cy={dims.box / 2} r={r} fill="none" strokeWidth={dims.stroke} className="stroke-neutral-4" />
          <circle
            cx={dims.box / 2} cy={dims.box / 2} r={r} fill="none" strokeWidth={dims.stroke} strokeLinecap="round"
            strokeDasharray={circ} className={cn('reveal-ring', tone.stroke)} style={vars}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('font-black tabular-nums leading-none text-foreground', dims.number)}>{formatScanScore(clamped)}</span>
          <span className={cn('font-medium text-muted-foreground', dims.suffix)}>{t('scoreRing.outOf')}</span>
        </div>
      </div>
    </div>
  )
}
