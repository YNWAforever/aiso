import { Search, TrendingUp, Wrench } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { RevealSteps } from '@/components/visuals/reveal/RevealSteps'
import { SectionHeading } from '@/components/marketing/landing/SectionHeading'

export function HowItWorks() {
  const t = useTranslations('landing.how')
  return (
    <section data-reveal aria-labelledby="how-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <SectionHeading id="how-title" eyebrow={t('eyebrow')} title={t('title')} align="center" />
      <RevealSteps
        className="mt-12"
        label={t('title')}
        steps={[
          { icon: <Search />, title: t('scan_title'), description: t('scan_body') },
          { icon: <Wrench />, title: t('fix_title'), description: t('fix_body') },
          { icon: <TrendingUp />, title: t('track_title'), description: t('track_body') },
        ]}
      />
    </section>
  )
}
