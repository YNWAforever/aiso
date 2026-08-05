import type { Metadata } from 'next'
import { appOrigin } from '@/lib/app-origin'
import { PRODUCT_FACTS } from '@/lib/product-facts'

export const SITE_URL = new URL(appOrigin())

export function localizedUrl(locale: string, path = ''): string {
  const suffix = path ? `/${path.replace(/^\//, '')}` : ''
  return new URL(`/${locale}${suffix}`, SITE_URL).toString().replace(/\/$/, '')
}

export function buildLocalizedMetadata(locale: string, path = ''): Metadata {
  const isZh = locale === 'zh-HK'
  const title = isZh ? 'Fimmick AISO｜AI 搜尋能見度掃描' : 'Fimmick AISO | AI Visibility Scan'
  const description = isZh
    ? '免費檢查網站是否容易被主要 AI 平台發現、理解及引用，並取得可執行的修復建議。'
    : 'Check whether leading AI platforms can find, understand, and cite your website, then get prioritized fixes.'

  return {
    title,
    description,
    alternates: {
      canonical: localizedUrl(locale, path),
      languages: {
        en: localizedUrl('en', path),
        'zh-HK': localizedUrl('zh-HK', path),
        'x-default': new URL('/', SITE_URL).toString(),
      },
    },
    openGraph: {
      type: 'website',
      url: localizedUrl(locale, path),
      siteName: 'Fimmick AISO',
      locale: isZh ? 'zh_HK' : 'en_US',
      title,
      description,
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export function buildSoftwareApplicationJsonLd(locale: string) {
  const isZh = locale === 'zh-HK'

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Fimmick AISO',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: localizedUrl(locale),
    description: isZh
      ? `執行 ${PRODUCT_FACTS.checkCount} 項 AI 搜尋就緒檢查，提供證據分數及優先修復建議。`
      : `Runs ${PRODUCT_FACTS.checkCount} AI search readiness checks and returns an evidence score with prioritized fixes.`,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: isZh ? '免費網站掃描' : 'Free website scan',
    },
  }
}
