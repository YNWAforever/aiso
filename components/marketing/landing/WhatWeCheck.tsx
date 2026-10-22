import { useTranslations } from 'next-intl'
import { SCAN_GRADE_BANDS } from '@/lib/score-display'
import { PILLAR_WEIGHTS, type Pillar } from '@/lib/marketing/landing'
import { CHECK_ICONS } from '@/components/marketing/landing/check-icons'
import { SectionHeading } from '@/components/marketing/landing/SectionHeading'
import { cn } from '@/lib/utils'

const PILLAR_STYLE: Record<Pillar, { bar: string; icon: string }> = {
  core: { bar: 'bg-primary', icon: 'bg-accent text-accent-foreground' },
  extended: { bar: 'bg-tone-info', icon: 'bg-tone-info-soft text-tone-info-fg' },
  geo: { bar: 'bg-tone-success', icon: 'bg-tone-success-soft text-tone-success-fg' },
}

/**
 * The three pillars as cards: points, an icon per check (named for screen
 * readers and on hover), and a bar showing the pillar's share of 100. The
 * grade scale under them keeps the accessible fractional band labels.
 */
export function WhatWeCheck() {
  const t = useTranslations('landing.checks')
  const checks = useTranslations('checks')
  const home = useTranslations('home')
  const pillars = (Object.keys(PILLAR_WEIGHTS) as Pillar[]).map(pillar => {
    const keys = Object.keys(PILLAR_WEIGHTS[pillar])
    return { pillar, keys, points: Object.values(PILLAR_WEIGHTS[pillar]).reduce((a, b) => a + b, 0) }
  })

  return (
    <section aria-labelledby="checks-title" className="border-y border-border bg-neutral-2 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading id="checks-title" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />
        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {pillars.map(({ pillar, keys, points }) => (
            <li key={pillar} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-e1">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-lg font-black text-foreground">{t(`${pillar}_title`)}</h3>
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">{t('points', { points })}</span>
              </div>
              <p className="text-sm text-muted-foreground">{t(`${pillar}_body`)}</p>
              <ul aria-label={t('checks_in', { pillar: t(`${pillar}_title`), count: keys.length })} className="flex flex-wrap gap-1.5">
                {keys.map(key => {
                  const Icon = CHECK_ICONS[key]!
                  return (
                    <li key={key} title={checks(key)} className={cn('flex size-9 items-center justify-center rounded-lg', PILLAR_STYLE[pillar].icon)}>
                      <Icon aria-hidden="true" className="size-4" />
                      <span className="sr-only">{checks(key)}</span>
                    </li>
                  )
                })}
              </ul>
              <div aria-hidden="true" className="mt-auto h-1.5 overflow-hidden rounded-full bg-neutral-4">
                <div className={cn('h-full w-full origin-left rounded-full', PILLAR_STYLE[pillar].bar)} style={{ transform: `scaleX(${points / 100})` }} />
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-8">
          <p className="text-sm font-semibold text-muted-foreground">{home('score_grades_label')}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {[...SCAN_GRADE_BANDS].reverse().map(band => (
              <li
                key={band.grade}
                aria-label={band.maxExclusive === null
                  ? home('score_grade_last_label', { grade: band.grade, min: band.minInclusive, max: 100 })
                  : home('score_grade_interval_label', { grade: band.grade, min: band.minInclusive, max: band.maxExclusive })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
              >
                <span className="font-black text-foreground">{band.grade}</span>
                {band.maxExclusive === null
                  ? home('score_grade_last', { min: band.minInclusive, max: 100 })
                  : home('score_grade_interval', { min: band.minInclusive, max: band.maxExclusive })}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
