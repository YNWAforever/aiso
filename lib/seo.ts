import type { Metadata } from 'next'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { appOrigin } from '@/lib/app-origin'
import { PRODUCT_FACTS } from '@/lib/product-facts'
import { BRAND, PRODUCT_NAME } from '@/lib/brand'

export const SITE_URL = new URL(appOrigin())

/** The company behind the product (a product-owner decision, UX Phase 8). No logo or sameAs until official ones exist. */
export const ORGANIZATION = { name: BRAND.company, url: 'https://www.fimmick.com' } as const

/**
 * The date the public marketing copy last changed, published as
 * dateModified. A real date kept by hand, not the build or request time,
 * which would claim every deploy rewrote the page. Update it with the copy.
 */
export const SITE_CONTENT_UPDATED = '2026-10-23'

export function buildOrganizationJsonLd() {
  return { '@context': 'https://schema.org', '@type': 'Organization', name: ORGANIZATION.name, url: ORGANIZATION.url }
}

export function localizedUrl(locale: string, path = ''): string {
  const suffix = path ? `/${path.replace(/^\//, '')}` : ''
  return new URL(`/${locale}${suffix}`, SITE_URL).toString().replace(/\/$/, '')
}

export function seoMessageKey(path: string): string {
  const key = path.replace(/^\/+|\/+$/g, '').replaceAll('/', '.') || 'home'
  return `seo.${key}`
}

function metadataMessage(catalog: unknown, key: string, locale: string): string {
  const value = key.split('.').reduce<unknown>((node, segment) =>
    node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined,
  catalog)
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${locale}: missing ${key}`)
  }
  return value
}

export function buildLocalizedMetadata(locale: string, path = ''): Metadata {
  const isZh = locale === 'zh-HK'
  const catalog = isZh ? zhHK : en
  const key = seoMessageKey(path)
  const title = metadataMessage(catalog, `${key}.title`, locale)
  const description = metadataMessage(catalog, `${key}.description`, locale)

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
      siteName: PRODUCT_NAME,
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
    name: PRODUCT_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: localizedUrl(locale),
    inLanguage: locale,
    dateModified: SITE_CONTENT_UPDATED,
    publisher: { '@type': 'Organization', name: ORGANIZATION.name, url: ORGANIZATION.url },
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
