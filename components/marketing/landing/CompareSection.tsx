import { useTranslations } from 'next-intl'
import { BeforeAfter } from '@/components/marketing/landing/BeforeAfter'
import { SectionHeading } from '@/components/marketing/landing/SectionHeading'

export function CompareSection() {
  const t = useTranslations('landing.compare')
  return (
    <section aria-labelledby="compare-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <SectionHeading id="compare-title" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />
      <div className="mt-10"><BeforeAfter /></div>
    </section>
  )
}
