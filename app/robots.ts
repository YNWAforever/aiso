import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'
import { SITE_AI_ALLOWED_AGENTS } from '@/lib/robots-policy'

/**
 * Everyone may crawl. AI search and user-triggered agents are also named
 * explicitly, so the site states its AI policy rather than leaving it to the
 * wildcard (our own c1 check asks for exactly that).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      { userAgent: [...SITE_AI_ALLOWED_AGENTS], allow: '/' },
    ],
    sitemap: new URL('/sitemap.xml', SITE_URL).toString(),
  }
}
