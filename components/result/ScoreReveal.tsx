'use client'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { formatScanScore } from '@/lib/score-display'
import { GRADES, TONE_CLASSES, gradeKey, gradeTone } from '@/components/visuals/tone'
import { ScoreRing } from '@/components/visuals/ScoreRing'

interface Props {
  score: number
  grade: string
  domain: string
  industry?: string | null
  region?: string | null
  /** The owner's previous scan of this domain, when there is one. */
  previous?: { score: number; grade: string } | null
}

/** Compatibility export retained from merged PR92; all scan displays share the same precision contract. */
export const formatScore = formatScanScore

/** True when the score went up or the grade moved to a better letter. */
export function isImprovement(score: number, grade: string, previous?: { score: number; grade: string } | null): boolean {
  if (!previous) return false
  const rank = (g: string) => { const i = (GRADES as readonly string[]).indexOf(g); return i < 0 ? GRADES.length : i }
  return score > previous.score || rank(grade) < rank(previous.grade)
}

/**
 * The result's one focal point: the score ring, the grade and one line on
 * what it means. The exact stored score is printed beside the ring, never a
 * rounded one, so a 89.97 never reads as an A.
 *
 * No industry-average comparison: the old one came from a hard-coded table
 * with no data behind it. Add one back only from measured scans, with n and date.
 *
 * The single celebration on the result page lives here: a soft glow behind the
 * ring, once, only when the owner's score improved or reached a better grade.
 */
export function ScoreReveal({ score, grade, domain, industry, region, previous }: Props) {
  const t = useTranslations('resultPage')
  const visuals = useTranslations('visuals')
  const industries = useTranslations('dashboard.industries')
  const tone = TONE_CLASSES[gradeTone(grade)]
  const industryLabel = industry ? (industries.has(industry) ? industries(industry) : industry) : null
  const improved = isImprovement(score, grade, previous)
  const newGrade = improved && previous && previous.grade !== grade

  return (
    <div data-testid="score-reveal" data-improved={improved || undefined} className="rounded-3xl border border-border bg-card p-6 shadow-e1 sm:p-8">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
        <div className="relative shrink-0">
          {improved && <span aria-hidden="true" className="result-glow pointer-events-none absolute inset-0 rounded-full bg-tone-success/30 blur-2xl" />}
          <ScoreRing score={score} grade={grade} previous={previous?.score ?? null} size="lg" className="relative" />
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h1 className="truncate text-xl font-black text-foreground">{domain}</h1>
          {(industryLabel || region) && (
            <p className="mt-1 text-xs text-muted-foreground">{[industryLabel, region].filter(Boolean).join(' · ')}</p>
          )}
          <div className="mt-3 inline-flex items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-lg font-black', tone.soft, tone.fg)}>
              {grade} <span className="text-sm font-semibold">— {visuals(`grade.${gradeKey(grade)}`)}</span>
            </span>
          </div>
          <p className="mt-3 text-base font-semibold text-foreground">{t(`grade_line.${gradeKey(grade)}`)}</p>
          <p className="mt-1 flex items-center justify-center gap-2 text-sm sm:justify-start">
            <span className="text-muted-foreground">{t('your_score')}</span>
            <span className="font-bold tabular-nums text-foreground">{formatScanScore(score)}/100</span>
          </p>
          {improved && (
            <p role="status" className="mt-2 text-sm font-semibold text-tone-success-fg">
              {t('improved')}{newGrade ? ` ${t('new_grade', { grade })}` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
