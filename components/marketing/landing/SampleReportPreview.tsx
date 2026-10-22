import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SAMPLE_CHECKS, SAMPLE_DOMAIN, sampleSummary, sampleTopFixes } from '@/lib/marketing/landing'
import { CHECK_ICONS } from '@/components/marketing/landing/check-icons'
import { SectionHeading } from '@/components/marketing/landing/SectionHeading'
import { RevealScoreRing } from '@/components/visuals/reveal/RevealScoreRing'
import { RevealPotentialBar } from '@/components/visuals/reveal/RevealPotentialBar'
import { RevealHeatmap } from '@/components/visuals/reveal/RevealHeatmap'
import { ScoreBadge } from '@/components/ui/score-badge'

/** What a result looks like, from a synthetic sample whose numbers come from the real weights. */
export function SampleReportPreview({ lang }: { lang: string }) {
  const t = useTranslations('landing.sample')
  const checks = useTranslations('checks')
  const summary = sampleSummary()
  const fixes = sampleTopFixes()

  return (
    <section aria-labelledby="sample-title" className="border-y border-border bg-neutral-2 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading id="sample-title" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />
        <div data-reveal className="mt-10 grid gap-6 rounded-3xl border border-border bg-card p-5 shadow-e2 sm:p-8 lg:grid-cols-[auto_1fr] lg:gap-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <RevealScoreRing score={summary.score} grade={summary.grade} size="lg" />
            <ScoreBadge grade={summary.grade} />
            <p className="text-sm font-semibold text-muted-foreground">{t('domain', { domain: SAMPLE_DOMAIN })}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <RevealPotentialBar current={summary.score} potential={summary.potential} />
            <div>
              <h3 className="text-base font-bold text-foreground">{t('top_fixes')}</h3>
              <ol className="mt-3 flex flex-col gap-2">
                {fixes.map(fix => {
                  const Icon = CHECK_ICONS[fix.key]!
                  return (
                    <li key={fix.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-tone-danger-soft text-tone-danger-fg"><Icon aria-hidden="true" className="size-4" /></span>
                      <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{t(`fix.${fix.key}`)}</span>
                      <span className="rounded-full bg-tone-success-soft px-2 py-0.5 text-xs font-semibold text-tone-success-fg">{t('impact', { points: fix.weight })}</span>
                      <span className="rounded-full bg-neutral-3 px-2 py-0.5 text-xs font-semibold text-neutral-11">{t(`effort.${fix.key}`)}</span>
                    </li>
                  )
                })}
              </ol>
            </div>
            <RevealHeatmap checks={SAMPLE_CHECKS.map(check => ({ key: check.key, label: checks(check.key), status: check.status, bucket: check.pillar }))} />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t('synthetic')}</p>
        <Link href={`/${lang}/sample-report`} className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-primary-accessible underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {t('link')}<ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </section>
  )
}
