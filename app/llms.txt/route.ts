import en from '@/messages/en.json'
import sitemap from '@/app/sitemap'
import { PRODUCT_FACTS } from '@/lib/product-facts'
import { SITE_URL, seoMessageKey } from '@/lib/seo'

/** The SEO title of a sitemap URL, from the catalogue its pages already use. */
function pageTitle(url: string): string {
  const [, locale = 'en', ...rest] = new URL(url).pathname.split('/')
  const key = seoMessageKey(rest.join('/'))
  const value = key.split('.').reduce<unknown>((node, part) =>
    node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, en)
  const title = value && typeof value === 'object' ? (value as { title?: unknown }).title : undefined
  const name = typeof title === 'string' ? title : url
  return locale === 'en' ? name : `${name} (${locale})`
}

export function GET() {
  const pages = sitemap().map(({ url }) => `- [${pageTitle(url)}](${url})`)
  const body = `# Fimmick AISO

> Fimmick AISO runs ${PRODUCT_FACTS.checkCount} AI readiness checks and scores website evidence out of ${PRODUCT_FACTS.scoreMaximum} points.

## Supported AI platforms
${PRODUCT_FACTS.platforms.map((platform) => `- ${platform}`).join('\n')}

## Fix Pack outputs
${PRODUCT_FACTS.fixPack.map((output) => `- ${output}`).join('\n')}

## Public pages
${pages.join('\n')}

## Machine-readable
- [Site description](${new URL('/.well-known/ai.json', SITE_URL).toString()})
- [Sitemap](${new URL('/sitemap.xml', SITE_URL).toString()})
`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
