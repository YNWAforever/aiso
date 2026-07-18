import type { MetadataRoute } from 'next'
import { localizedUrl } from '@/lib/seo'

const LOCALES = ['en', 'zh-HK'] as const
const PUBLIC_ROUTES = ['', 'pricing'] as const

export default function sitemap(): MetadataRoute.Sitemap {
  return LOCALES.flatMap((locale) =>
    PUBLIC_ROUTES.map((path) => ({
      url: localizedUrl(locale, path),
      changeFrequency: path ? 'monthly' : 'weekly',
      priority: path ? 0.8 : 1,
    })),
  )
}
