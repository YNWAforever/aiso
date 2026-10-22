import Link from 'next/link'
import { ArrowRight, CreditCard, UserX } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ScanForm } from '@/components/home/ScanForm'
import { HeroDemo } from '@/components/visuals/HeroDemo'

/**
 * One value line, one URL input, one primary button. The scan runs inline
 * through the existing ScanForm (POST /api/scan, no sign-up). The demo is
 * decorative; the h1 is the LCP element, so the animation never delays it.
 */
export function Hero({ lang }: { lang: string }) {
  const t = useTranslations('landing.hero')
  return (
    <section id="scan" aria-labelledby="hero-title" className="relative overflow-hidden border-b border-border">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-[32rem] bg-gradient-to-b from-primary/10 to-transparent" />
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-10 px-4 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <div>
          <p className="inline-flex items-center rounded-full border border-primary/25 bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">{t('eyebrow')}</p>
          <h1 id="hero-title" className="mt-4 max-w-2xl text-balance text-4xl font-black leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-display">
            {t('title')}
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-lg text-muted-foreground">{t('subtitle')}</p>
          <div className="mt-7 rounded-2xl border border-border bg-card p-4 shadow-e2 sm:p-5">
            <ScanForm lang={lang} />
            <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-sm font-medium text-muted-foreground">
              <li className="inline-flex items-center gap-1.5"><UserX aria-hidden="true" className="size-4 text-tone-success-fg" />{t('no_signup')}</li>
              <li className="inline-flex items-center gap-1.5"><CreditCard aria-hidden="true" className="size-4 text-tone-success-fg" />{t('no_card')}</li>
            </ul>
          </div>
          <Link href={`/${lang}/sample-report`} className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-primary-accessible underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            {t('sample_link')}<ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <HeroDemo score={72} className="mx-auto lg:ml-auto" />
      </div>
    </section>
  )
}
