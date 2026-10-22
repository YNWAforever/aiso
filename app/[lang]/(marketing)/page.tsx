import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PRODUCT_FACTS } from '@/lib/product-facts'
import { buildLocalizedMetadata, buildSoftwareApplicationJsonLd } from '@/lib/seo'
import { Hero } from '@/components/marketing/landing/Hero'
import { ProofStrip } from '@/components/marketing/landing/ProofStrip'
import { HowItWorks } from '@/components/marketing/landing/HowItWorks'
import { WhatWeCheck } from '@/components/marketing/landing/WhatWeCheck'
import { CompareSection } from '@/components/marketing/landing/CompareSection'
import { SampleReportPreview } from '@/components/marketing/landing/SampleReportPreview'
import { PricingTable } from '@/components/marketing/landing/PricingTable'
import { Faq } from '@/components/marketing/landing/Faq'
import { FinalCta } from '@/components/marketing/landing/FinalCta'

type HomePageProps = {
  params: Promise<{ lang: string }>
}

const FAQ_KEYS = ['what', 'signup', 'score', 'platforms', 'fixpack'] as const

export async function generateMetadata({ params }: HomePageProps): Promise<Metadata> {
  const { lang } = await params
  return buildLocalizedMetadata(lang)
}

/**
 * Landing page (UX Phase 2, docs/ux/target-ia.md §3.1): scan → how it works →
 * what we check → before/after → sample result → pricing → FAQ → scan again.
 * One primary call to action per viewport: the scan form at the top and bottom.
 */
export default async function HomePage({ params }: HomePageProps) {
  const { lang } = await params
  const t = await getTranslations({ locale: lang, namespace: 'landing.faq' })
  const platformList = new Intl.ListFormat(lang === 'zh-HK' ? 'zh-HK' : 'en', { style: 'long', type: 'conjunction' }).format(PRODUCT_FACTS.platforms)
  const faqs = FAQ_KEYS.map(key => ({
    q: t(`${key}_q`),
    a: t(`${key}_a`, { count: PRODUCT_FACTS.checkCount, platforms: platformList }),
  }))
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: lang,
    mainEntity: faqs.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }

  return (
    <div className="bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildSoftwareApplicationJsonLd(lang)).replace(/</g, '\\u003c') }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c') }}
      />
      <Hero lang={lang} />
      <ProofStrip />
      <HowItWorks />
      <WhatWeCheck />
      <CompareSection />
      <SampleReportPreview lang={lang} />
      <PricingTable lang={lang} />
      <Faq eyebrow={t('eyebrow')} title={t('title')} items={faqs} />
      <FinalCta lang={lang} />
    </div>
  )
}
