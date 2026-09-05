import type { MetadataRoute } from 'next'
import { localizedUrl } from '@/lib/seo'
import { NAV } from '@/lib/navigation'
import { routing } from '@/i18n/routing'

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = NAV.filter((entry) => entry.available)
  return routing.locales.flatMap((locale) =>
    routes.map(({ href }) => {
      const path = href === '/' ? '' : href
      return {
        url: localizedUrl(locale, path),
        changeFrequency: path ? 'monthly' : 'weekly',
        priority: path ? 0.8 : 1,
      }
    }),
  )
}
