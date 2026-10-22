import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { TONE_CLASSES, gradeKey, gradeTone } from '@/components/visuals/tone'

const SIZES = {
  sm: 'gap-1 px-2 py-0.5 text-xs',
  md: 'gap-1.5 px-2.5 py-1 text-sm',
  lg: 'gap-2 px-3.5 py-1.5 text-base',
} as const

export interface ScoreBadgeProps {
  grade: string
  /** Show the word ("Good") after the letter. */
  showLabel?: boolean
  size?: keyof typeof SIZES
  className?: string
}

/** The letter grade in its tone. The letter itself carries the meaning, never the colour alone. */
export function ScoreBadge({ grade, showLabel = true, size = 'md', className }: ScoreBadgeProps) {
  const t = useTranslations('visuals')
  const tone = TONE_CLASSES[gradeTone(grade)]
  const label = t(`grade.${gradeKey(grade)}`)
  return (
    <span
      className={cn('inline-flex items-center rounded-full border font-semibold', tone.soft, tone.fg, tone.border, SIZES[size], className)}
      data-testid="score-badge"
    >
      <span className="font-black" aria-hidden={showLabel ? undefined : true}>{grade}</span>
      {showLabel ? <span>{label}</span> : <span className="sr-only">{t('scoreBadge.label', { grade, gradeLabel: label })}</span>}
    </span>
  )
}
