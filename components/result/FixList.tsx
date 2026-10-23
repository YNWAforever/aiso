'use client'
import { ChevronRight, Clock } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { getCheckActionCopy } from '@/lib/checkExplanations'
import { TONE_CLASSES, statusTone } from '@/components/visuals/tone'
import { CHECK_ICONS } from '@/components/visuals/check-icons'
import { formatScanScore } from '@/lib/score-display'
import type { FixItem } from '@/lib/result/view-model'

interface Props {
  fixes: readonly FixItem[]
  onSelect: (key: string) => void
}

/**
 * The top fixes, worth the most points first. Each row is one button: icon,
 * one-line problem, an impact chip and an effort chip. Details open in the
 * check drawer.
 */
export function FixList({ fixes, onSelect }: Props) {
  const t = useTranslations('resultPage')
  const checkNames = useTranslations('checks')
  const locale = useLocale()

  return (
    <ol className="flex flex-col gap-2">
      {fixes.map(fix => {
        const Icon = CHECK_ICONS[fix.key]
        const tone = TONE_CLASSES[statusTone(fix.assessment)]
        const title = getCheckActionCopy(fix.key, locale)?.title ?? checkNames(fix.key)
        const points = formatScanScore(fix.points)
        return (
          <li key={fix.key}>
            <button
              type="button"
              onClick={() => onSelect(fix.key)}
              aria-label={`${title}. ${t('impact_label', { points })}. ${t('effort_label', { effort: t(`effort.${fix.effort}`) })}`}
              className="group flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-e1 card-interactive"
            >
              <span aria-hidden="true" className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg border', tone.soft, tone.fg, tone.border)}>
                {Icon && <Icon className="size-4" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{title}</span>
                <span aria-hidden="true" className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-tone-success-soft px-2 py-0.5 text-xs font-bold tabular-nums text-tone-success-fg">{t('fix_points', { points })}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-neutral-3 px-2 py-0.5 text-xs font-medium text-foreground">
                    <Clock className="size-3" />{t(`effort.${fix.effort}`)}
                  </span>
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </button>
          </li>
        )
      })}
    </ol>
  )
}
