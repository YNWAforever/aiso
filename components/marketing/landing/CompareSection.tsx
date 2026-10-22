import { BadgeCheck, CircleSlash, Sparkles, User } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { SectionHeading } from '@/components/marketing/landing/SectionHeading'
import { revealDelay } from '@/components/visuals/reveal/reveal'

/**
 * The same question asked twice: once to an assistant that cannot cite the
 * site, once to one that can. Clearly labelled as an illustration; the brand
 * and answers are invented, never a recorded AI response. Server-rendered with
 * CSS reveals, so it costs no hydration.
 */
export function CompareSection() {
  const t = useTranslations('landing.compare')
  return (
    <section aria-labelledby="compare-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <SectionHeading id="compare-title" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />
      <div data-reveal className="mt-10 grid gap-4 md:grid-cols-2">
        {(['before', 'after'] as const).map((side, i) => {
          const cited = side === 'after'
          return (
            <figure key={side} className={cn('reveal-up flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-e1', cited ? 'border-tone-success/40' : 'border-border')} style={revealDelay(i * 4)}>
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
                    <span className="reveal-pop inline-flex w-fit items-center gap-1 rounded-full border border-tone-success/40 bg-card px-2 py-0.5 text-xs font-semibold text-tone-success-fg" style={revealDelay(11)}>
                      <BadgeCheck aria-hidden="true" className="size-3.5" />{t('source')}
                    </span>
                  )}
                </div>
              </div>
            </figure>
          )
        })}
        <p className="text-xs text-muted-foreground md:col-span-2">{t('illustration')}</p>
      </div>
    </section>
  )
}
